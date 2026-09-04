import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { ACTIVE_SECONDS, TROOP_RADIUS } from "../config/itemsConfig.js";
import { getStorageLocation, setTag, getTag, isBarbarian, isArcher, isDragon, isTroop } from "../spawner/spawnerHelpers.js";


const PORTAL_BLOCK = "subo:portal";
const PORTAL_ENTITY = "subo:portal_entity";

// Used for decoding dynamic property data 
const DIM_CODES = { "minecraft:overworld": 0, "minecraft:nether": 1, "minecraft:the_end": 2 };
const DIM_NAMES = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const FACING_CODES = { north: 0, south: 1, west: 2, east: 3 };
const FACING_NAMES = ["north", "south", "west", "east"];

// Active portals: Map<"dim:x:y:z", { dest, expireTick, activator }>
const activePortals = new Map();
let portalTickId = null;

// Break dedupe:
// key = "dimension|lowerX|lowerY|lowerZ"
const pendingPortalBreaks = new Map();
const suppressedPortalBreaks = new Set();

// On load: any portal that was left visually open is forced closed
system.runTimeout(() => {
    for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
        let ents;
        try { ents = world.getDimension(dimId).getEntities({ type: PORTAL_ENTITY }); }
        catch { continue; }

        for (const e of ents) {
            // clear any leftover timer tag (copy first so we don't mutate while iterating)
            for (const t of [...e.getTags()]) {
                if (t.startsWith("activeUntil:")) e.removeTag(t);
            }
            // force visual off
            const loc = {
                x: Number(getTag(e, "x:", 0)),
                y: Number(getTag(e, "y:", 0)),
                z: Number(getTag(e, "z:", 0))
            };
            try {
                const lower = world.getDimension(dimId).getBlock(loc);
                if (lower?.typeId === PORTAL_BLOCK) setActive(lower, false);
            } catch { }
        }
    }
    activePortals.clear();
}, 20);

function loadPortalRegistry() {
    try {
        const raw = world.getDynamicProperty("subo:portals");
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function savePortalRegistry(data) {
    world.setDynamicProperty("subo:portals", JSON.stringify(data));
}

/** Turn the compact array back into the object the rest of the code expects */
function expandPortal(arr) {
    return {
        id: arr[0],
        name: arr[1],
        x: arr[2],
        y: arr[3],
        z: arr[4],
        dim: DIM_NAMES[arr[5]] ?? "minecraft:overworld",
        facing: FACING_NAMES[arr[6]] ?? "north"
    };
}

/** Turn a normal portal object into the compact array */
function compactPortal(p) {
    return [
        p.id,
        p.name,
        Math.floor(p.x),
        Math.floor(p.y),
        Math.floor(p.z),
        DIM_CODES[p.dim] ?? 0,
        FACING_CODES[p.facing] ?? 0
    ];
}

function getPortalEntity(block) {
    if (!block) return null;

    const storageLoc = getStorageLocation(block);

    const ents = block.dimension.getEntities({
        type: PORTAL_ENTITY,
        location: storageLoc,
        maxDistance: 0.5
    });

    return ents[0] ?? null;
}

function findPortalAt(block) {
    if (!block) return null;

    // Prefer the live entity when the chunk is loaded
    const entity = getPortalEntity(block);
    if (entity) {
        const portal = portalDataFromEntity(entity);
        if (portal?.id) return { owner: portal.owner, portal, entity };
    }

    // Fallback to the persistent registry
    const all = loadPortalRegistry();
    const fx = Math.floor(block.location.x);
    const fy = Math.floor(block.location.y);
    const fz = Math.floor(block.location.z);
    const dimensionId = block.dimension.id;

    for (const owner in all) {
        for (const arr of all[owner]) {
            const p = expandPortal(arr);
            if (p.dim === dimensionId &&
                Math.floor(p.x) === fx &&
                Math.floor(p.y) === fy &&
                Math.floor(p.z) === fz) {
                return { owner, portal: p, entity: null };
            }
        }
    }
    return null;
}

function portalDataFromEntity(entity) {
    if (!entity) return null;
    return {
        id: getTag(entity, "id:", null),
        name: getTag(entity, "name:", null),
        owner: getTag(entity, "owner:", null),
        x: Number(getTag(entity, "x:", 0)),
        y: Number(getTag(entity, "y:", 0)),
        z: Number(getTag(entity, "z:", 0)),
        dim: (getTag(entity, "dim:", null) || "").replace("_", ":"),   // back to "minecraft:overworld"
        facing: getTag(entity, "facing:", "north")
    };
}

function getPlayerPortals(playerName) {
    const all = loadPortalRegistry();
    return (all[playerName] || []).map(expandPortal);
}

function removePortalEntity(entity) {
    if (entity?.isValid) entity.remove();
}

function tryGivePortalItem(player) {
    const TYPE = "subo:portal";
    const inv = player.getComponent("inventory")?.container;
    if (!inv) return false;

    // Prefer adding to an existing stack that still has room
    for (let i = 0; i < inv.size; i++) {
        const slot = inv.getItem(i);
        if (slot && slot.typeId === TYPE && slot.amount < slot.maxAmount) {
            slot.amount += 1;
            inv.setItem(i, slot);
            return true;
        }
    }

    // Otherwise use an empty slot
    if (inv.emptySlotsCount > 0) {
        inv.addItem(new ItemStack(TYPE, 1));
        return true;
    }

    return false; // completely full
}

function getLowerPortalBlock(block) {
    if (block.permutation.getState("subo:half") === "upper") {
        return block.dimension.getBlock({
            x: block.location.x,
            y: block.location.y - 1,
            z: block.location.z
        });
    }
    return block;
}

function setActive(lowerBlock, active) {
    if (!lowerBlock || lowerBlock.typeId !== PORTAL_BLOCK) return;

    const upper = lowerBlock.dimension.getBlock({
        x: lowerBlock.location.x,
        y: lowerBlock.location.y + 1,
        z: lowerBlock.location.z
    });

    try {
        lowerBlock.setPermutation(
            lowerBlock.permutation.withState("subo:active", active)
        );
        if (upper?.typeId === PORTAL_BLOCK) {
            upper.setPermutation(
                upper.permutation.withState("subo:active", active)
            );
        }
    } catch { }
}

function playExpandParticle(dim, loc, maxRadius = 20) {
    let t = 0;
    const id = system.runInterval(() => {
        t += 1;
        const progress = t / 40;               // 2 seconds total
        const radius = progress < 0.5
            ? maxRadius * (progress * 2)       // grow
            : maxRadius * (2 - progress * 2);  // shrink

        // spawn a ring of particles
        try {
            for (let i = 0; i < TROOP_RADIUS; i++) {
                const angle = (i / TROOP_RADIUS) * Math.PI * 2;
                dim.spawnParticle("minecraft:mob_portal", {
                    x: loc.x + Math.cos(angle) * radius,
                    y: loc.y + 1,
                    z: loc.z + Math.sin(angle) * radius
                });
            }
        } catch (error) {

        }

        if (t >= 40) system.clearRun(id);
    }, 2);
}

// ===== Placement → name prompt =====
world.afterEvents.playerPlaceBlock.subscribe(async (ev) => {
    if (ev.block.typeId !== PORTAL_BLOCK) return;

    const player = ev.player;
    const lower = ev.block;
    const dim = lower.dimension;
    const facing = lower.permutation.getState("minecraft:cardinal_direction") || "north";

    const upperLoc = { x: lower.location.x, y: lower.location.y + 1, z: lower.location.z };
    const above = dim.getBlock(upperLoc);
    if (!above || above.typeId !== "minecraft:air") {
        tryGivePortalItem(player);
        removePortalBlocksNoDrop(dim, lower.location);
        player.sendMessage("§cNot enough space for the portal (needs 2 blocks high).");
        return;
    }

    const upperPerm = BlockPermutation.resolve(PORTAL_BLOCK, {
        "subo:half": "upper",
        "minecraft:cardinal_direction": facing,
        "subo:active": false
    });
    above.setPermutation(upperPerm);

    lower.setPermutation(lower.permutation
        .withState("subo:half", "lower")
        .withState("subo:active", false));

    const form = new ModalFormData()
        .title("Name Your Portal")
        .textField("Portal name (must be unique for you)", "e.g. Home Base");

    const response = await form.show(player);
    if (response.canceled || !response.formValues?.[0]?.trim()) {
        tryGivePortalItem(player);
        removePortalBlocksNoDrop(dim, lower.location);
        player.sendMessage("§cPortal naming cancelled.");
        return;
    }

    const name = response.formValues[0].trim();
    const existing = getPlayerPortals(player.name);
    if (existing.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        tryGivePortalItem(player);
        removePortalBlocksNoDrop(dim, lower.location);
        player.sendMessage("§cYou already have a portal named that!");
        return;
    }

    // spawn persistence entity (same pattern as purifier)
    system.run(() => {
        if (!getPortalEntity(lower)) {
            const entity = dim.spawnEntity(PORTAL_ENTITY, getStorageLocation(lower));
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            setTag(entity, "id:", id);
            setTag(entity, "name:", name);
            setTag(entity, "owner:", player.name);
            setTag(entity, "x:", lower.location.x);
            setTag(entity, "y:", lower.location.y);
            setTag(entity, "z:", lower.location.z);
            setTag(entity, "dim:", dim.id.replace(":", "_"));
            setTag(entity, "facing:", facing);

            // compact registry entry
            const all = loadPortalRegistry();
            if (!all[player.name]) all[player.name] = [];
            all[player.name].push(compactPortal({
                id,
                name,
                x: lower.location.x,
                y: lower.location.y,
                z: lower.location.z,
                dim: dim.id,
                facing
            }));
            savePortalRegistry(all);
        }
    });

    player.sendMessage(`§aPortal "${name}" created!`);
});

const formOpenPlayers = new Set();

// ===== Right-click → choose destination =====
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
    if (ev.block?.typeId !== "subo:portal") return;
    if (ev.player.isSneaking) return;

    // Cancel so the held item is not used
    ev.cancel = true;

    const player = ev.player;
    if (formOpenPlayers.has(player.id)) return;   // already opening

    formOpenPlayers.add(player.id);

    // Capture the block data NOW (before the block reference becomes invalid)
    const blockLoc = {
        x: ev.block.location.x,
        y: ev.block.location.y,
        z: ev.block.location.z
    };
    const dimId = ev.block.dimension.id;

    system.run(() => {
        openPortalConnectForm(player, blockLoc, dimId);

        // release the guard after a short delay
        system.runTimeout(() => formOpenPlayers.delete(player.id), 10);
    });
});

function openPortalConnectForm(player, blockLoc, dimId) {
    const dim = world.getDimension(dimId);
    let block = dim.getBlock(blockLoc);
    if (!block || block.typeId !== PORTAL_BLOCK) return;

    const lower = getLowerPortalBlock(block);
    if (!lower || lower.typeId !== PORTAL_BLOCK) return;

    const found = findPortalAt(lower);
    if (!found) {
        player.sendMessage("§cThis portal is not registered.");
        return;
    }

    const myPortals = getPlayerPortals(player.name);
    if (myPortals.length === 0) {
        player.sendMessage("§cYou have no portals to connect to.");
        return;
    }

    const choices = myPortals.filter(p => p.id !== found.portal.id);
    if (choices.length === 0) {
        player.sendMessage("§cYou need at least one other portal.");
        return;
    }

    const form = new ModalFormData()
        .title("Portal: " + found.portal.name)
        .dropdown("Destination", choices.map(p => p.name), { defaultValueIndex: 0 })
        .toggle("Bring this portal with me", { defaultValue: false });

    form.show(player).then((response) => {
        if (response.canceled || !response.formValues) return;

        const destIndex = response.formValues[0];
        const bringPortal = response.formValues[1];
        const dest = choices[destIndex];

        activatePortal(lower, dest, player, bringPortal); // Passing the lower block
    });
}

function cloneBlockLoc(loc) {
    return {
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z)
    };
}

function portalKeyFromLoc(dimId, loc) {
    return `${dimId}|${Math.floor(loc.x)}|${Math.floor(loc.y)}|${Math.floor(loc.z)}`;
}

function lowerLocFromBrokenHalf(loc, half) {
    const out = cloneBlockLoc(loc);

    if (half === "upper") {
        out.y -= 1;
    }

    return out;
}

function unregisterPortal(found) {
    if (!found) return;

    const all = loadPortalRegistry();

    if (all[found.owner]) {
        all[found.owner] = all[found.owner].filter(arr => arr[0] !== found.portal.id);

        if (all[found.owner].length === 0) {
            delete all[found.owner];
        }

        savePortalRegistry(all);
    }

    if (found.entity) {
        removePortalEntity(found.entity);
    }
}

function removePortalBlocksNoDrop(dim, lowerLoc) {
    const key = portalKeyFromLoc(dim.id, lowerLoc);

    // Prevent our custom component from treating this scripted removal as a real break.
    suppressedPortalBreaks.add(key);

    try {
        const upper = dim.getBlock({
            x: lowerLoc.x,
            y: lowerLoc.y + 1,
            z: lowerLoc.z
        });

        const lower = dim.getBlock(lowerLoc);

        if (upper?.typeId === PORTAL_BLOCK) {
            upper.setType("minecraft:air");
        }

        if (lower?.typeId === PORTAL_BLOCK) {
            lower.setType("minecraft:air");
        }
    } catch { }

    // Keep suppression alive for a few ticks because setType can cause component callbacks.
    system.runTimeout(() => {
        suppressedPortalBreaks.delete(key);
    }, 5);
}

export function queuePortalBreak(dim, brokenLoc, half) {
    const lowerLoc = lowerLocFromBrokenHalf(brokenLoc, half);
    const key = portalKeyFromLoc(dim.id, lowerLoc);

    // Already intentionally removed, or already queued from the other half.
    if (suppressedPortalBreaks.has(key)) return;
    if (pendingPortalBreaks.has(key)) return;

    pendingPortalBreaks.set(key, {
        dim,
        lowerLoc
    });

    // Suppress duplicate callbacks from the second half immediately.
    suppressedPortalBreaks.add(key);

    // Run next tick so if an explosion breaks both halves in the same tick,
    // both callbacks have a chance to arrive before we process.
    system.run(() => {
        processQueuedPortalBreak(key);
    });
}

function processQueuedPortalBreak(key) {
    const job = pendingPortalBreaks.get(key);
    if (!job) return;

    pendingPortalBreaks.delete(key);

    const { dim, lowerLoc } = job;

    let found = null;

    try {
        // This can be an air block by now. That is okay.
        // findPortalAt() only needs the location/dimension for registry/entity lookup.
        const lookupBlock = dim.getBlock(lowerLoc);
        if (lookupBlock) {
            found = findPortalAt(lookupBlock);
        }
    } catch { }

    unregisterPortal(found);

    // Remove active state/timer memory.
    activePortals.delete(key);

    // Remove whichever half survived.
    // The key is still in suppressedPortalBreaks, so these setType calls will not re-drop.
    try {
        const upper = dim.getBlock({
            x: lowerLoc.x,
            y: lowerLoc.y + 1,
            z: lowerLoc.z
        });

        const lower = dim.getBlock(lowerLoc);

        if (upper?.typeId === PORTAL_BLOCK) {
            upper.setType("minecraft:air");
        }

        if (lower?.typeId === PORTAL_BLOCK) {
            lower.setType("minecraft:air");
        }
    } catch { }

    // Scripted single drop.
    // Since native loot is empty, this is the only portal item that drops.
    try {
        dim.spawnItem(new ItemStack(PORTAL_BLOCK, 1), {
            x: lowerLoc.x + 0.5,
            y: lowerLoc.y + 0.5,
            z: lowerLoc.z + 0.5
        });
    } catch { }

    system.runTimeout(() => {
        suppressedPortalBreaks.delete(key);
    }, 5);
}

function activatePortal(block, dest, activator, bringPortal = false) {
    // Safety: make sure we have the lower half
    const lower = getLowerPortalBlock(block);
    if (!lower || lower.typeId !== PORTAL_BLOCK) return;

    const key = `${lower.dimension.id}|${Math.floor(lower.location.x)}|${Math.floor(lower.location.y)}|${Math.floor(lower.location.z)}`;
    const expire = system.currentTick + (ACTIVE_SECONDS * 20);

    activePortals.set(key, {
        dest,
        expireTick: expire,
        activatorName: activator.name,
        bringPortal
    });

    // Activate BOTH halves
    setActive(lower, true);

    ensurePortalTicker();  // Start the portal ticker

    const entity = getPortalEntity(lower);
    if (entity) {
        setTag(entity, "activeUntil:", expire);   // expire already computed above
    }

    activator.sendMessage(`§aPortal open to "${dest.name}" for ${ACTIVE_SECONDS} seconds!`);
    lower.dimension.playSound("portal.trigger", lower.location, { volume: 1, pitch: 1 });
    playExpandParticle(lower.dimension, {
        x: lower.location.x + 0.5,
        y: lower.location.y,
        z: lower.location.z + 0.5
    });
}

// ===== Teleport anyone standing in an active portal =====
function ensurePortalTicker() {
    if (portalTickId !== null) return;          // already running

    portalTickId = system.runInterval(() => {
        const now = system.currentTick;

        // --- 1. clean up any portal entities whose time has expired
        //     (works even after the chunk was unloaded and later reloaded)
        for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
            let ents;
            try { ents = world.getDimension(dimId).getEntities({ type: PORTAL_ENTITY }); }
            catch { continue; }

            for (const e of ents) {
                const until = getTag(e, "activeUntil:", null);
                if (until === null) continue;

                if (now >= Number(until)) {
                    // force visual off
                    const loc = {
                        x: Number(getTag(e, "x:", 0)),
                        y: Number(getTag(e, "y:", 0)),
                        z: Number(getTag(e, "z:", 0))
                    };
                    try {
                        const lower = world.getDimension(dimId).getBlock(loc);
                        if (lower?.typeId === PORTAL_BLOCK) setActive(lower, false);
                    } catch { }

                    // clear the tag robustly
                    for (const t of [...e.getTags()]) {
                        if (t.startsWith("activeUntil:")) e.removeTag(t);
                    }

                    // also drop from the in-memory map if it is still there
                    const key = `${dimId}|${Math.floor(loc.x)}|${Math.floor(loc.y)}|${Math.floor(loc.z)}`;
                    activePortals.delete(key);
                }
            }
        }

        // --- 1b. any portal that is still visually active but has NO activeUntil tag
        //         (chunk was unloaded while the timer expired) → force closed
        for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
            let ents;
            try { ents = world.getDimension(dimId).getEntities({ type: PORTAL_ENTITY }); }
            catch { continue; }

            for (const e of ents) {
                // still has a live timer? leave it alone
                if (getTag(e, "activeUntil:", null) !== null) continue;

                const loc = {
                    x: Number(getTag(e, "x:", 0)),
                    y: Number(getTag(e, "y:", 0)),
                    z: Number(getTag(e, "z:", 0))
                };
                try {
                    const lower = world.getDimension(dimId).getBlock(loc);
                    if (lower?.typeId === PORTAL_BLOCK &&
                        lower.permutation.getState("subo:active") === true) {
                        setActive(lower, false);
                    }
                } catch { }
            }
        }

        // --- 2. normal teleport logic for currently loaded active portals
        for (const [key, data] of activePortals) {
            if (now >= data.expireTick) {
                // best-effort visual + tag cleanup (only works if chunk is still loaded)
                try {
                    const parts = key.split("|");
                    const d = world.getDimension(parts[0]);
                    const lower = d.getBlock({ x: +parts[1], y: +parts[2], z: +parts[3] });

                    if (lower?.typeId === PORTAL_BLOCK) {
                        setActive(lower, false);
                    }

                    if (lower) {
                        const ent = getPortalEntity(lower);
                        if (ent) {
                            for (const t of [...ent.getTags()]) {
                                if (t.startsWith("activeUntil:")) ent.removeTag(t);
                            }
                        }
                    }
                } catch { }

                activePortals.delete(key);
                continue;
            }

            const parts = key.split("|");
            const dimId = parts[0];
            const sx = parts[1], sy = parts[2], sz = parts[3];
            const dim = world.getDimension(dimId);
            const portalLoc = { x: +sx + 0.5, y: +sy, z: +sz + 0.5 };

            const players = dim.getPlayers({ location: portalLoc, maxDistance: 0.5 });

            for (const player of players) {
                const destDim = world.getDimension(data.dest.dim);
                const destLoc = {
                    x: data.dest.x + 0.5,
                    y: data.dest.y,
                    z: data.dest.z + 0.5
                };

                let needDropPortal = false;

                if (data.bringPortal && player.name === data.activatorName) {
                    const lower = dim.getBlock({ x: +sx, y: +sy, z: +sz });
                    const found = lower ? findPortalAt(lower) : null;
                    if (found) {
                        const all = loadPortalRegistry();
                        if (all[found.owner]) {
                            all[found.owner] = all[found.owner].filter(arr => arr[0] !== found.portal.id);
                            if (all[found.owner].length === 0) delete all[found.owner];
                            savePortalRegistry(all);
                        }
                        if (found.entity) removePortalEntity(found.entity);
                    }

                    try {
                        removePortalBlocksNoDrop(dim, {
                            x: +sx,
                            y: +sy,
                            z: +sz
                        });
                    } catch { }

                    if (tryGivePortalItem(player)) {
                        player.sendMessage("§aPortal collected into your inventory.");
                    } else {
                        needDropPortal = true;
                    }
                    activePortals.delete(key);
                }

                const isOverworldOnly = dimId === "minecraft:overworld" && data.dest.dim === "minecraft:overworld";

                const troopsToBring = [];
                const troopsToStrip = [];

                const nearby = dim.getEntities({
                    location: portalLoc,
                    maxDistance: TROOP_RADIUS
                });

                for (const ent of nearby) {
                    if (!isTroop(ent.typeId)) continue;

                    const ownerTag = ent.getTags().find(t => t.startsWith("owner:"));
                    if (!ownerTag || ownerTag !== `owner:${player.name}`) continue;

                    // Only currently following troops
                    const mark = ent.getComponent("minecraft:mark_variant");
                    if (!mark || mark.value !== 1) continue;

                    if (isOverworldOnly) {
                        troopsToBring.push(ent);
                    } else {
                        troopsToStrip.push(ent);
                    }
                }

                // Cross-dimension: force stay + mark them so we can restore later
                for (const ent of troopsToStrip) {
                    const events = getStayFollowEvents(ent.typeId);
                    if (events) {
                        try { ent.triggerEvent(events.stay); } catch { }
                    }
                    try { ent.addTag("subo:resume_follow"); } catch { }
                }

                // Small delay so the stay event has time to apply
                system.runTimeout(() => {
                    // Teleport the player
                    try {
                        player.teleport(destLoc, { dimension: destDim });
                        player.sendMessage(`§bTeleported to "${data.dest.name}"`);

                        if (needDropPortal) {
                            system.runTimeout(() => {
                                try {
                                    player.dimension.spawnItem(new ItemStack("subo:portal", 1), player.location);
                                    player.sendMessage("§eInventory full – portal dropped at your feet.");
                                } catch { }
                            }, 10);
                        }
                    } catch { }

                    // Bring troops (Overworld → Overworld only)
                    for (const ent of troopsToBring) {
                        if (!ent.isValid) continue;

                        const targetLoc = {
                            x: destLoc.x + (Math.random() - 0.5) * 1.5,
                            y: destLoc.y,
                            z: destLoc.z + (Math.random() - 0.5) * 1.5
                        };

                        try {
                            ent.teleport(targetLoc, { dimension: destDim });
                        } catch { }
                    }

                    // Restore any nearby troops that were previously forced into stay mode
                    const toRestore = destDim.getEntities({
                        location: destLoc,
                        maxDistance: TROOP_RADIUS
                    });

                    for (const ent of toRestore) {
                        if (!isTroop(ent.typeId)) continue;
                        if (!ent.hasTag("subo:resume_follow")) continue;

                        const ownerTag = ent.getTags().find(t => t.startsWith("owner:"));
                        if (!ownerTag || ownerTag !== `owner:${player.name}`) continue;

                        const events = getStayFollowEvents(ent.typeId);
                        if (events) {
                            try { ent.triggerEvent(events.follow); } catch { }
                        }
                        try { ent.removeTag("subo:resume_follow"); } catch { }
                    }
                }, 2);

            }
        }

        if (activePortals.size === 0) {
            system.clearRun(portalTickId);
            portalTickId = null;
        }
    }, 5);
}

function getStayFollowEvents(typeId) {
    if (isBarbarian(typeId)) return { stay: "barbarian:stay", follow: "barbarian:follow" };
    if (isArcher(typeId)) return { stay: "archer:stay", follow: "archer:follow" };
    if (isDragon(typeId)) return { stay: "dragon:stay", follow: "dragon:follow" };
    return null;
}

// ===== Clean up when portal is broken =====
// Fallback for player breaks.
// If the custom component also fires for player breaks, the queue dedupe prevents double handling.
world.afterEvents.playerBreakBlock.subscribe((ev) => {
    if (ev.brokenBlockPermutation.type.id !== PORTAL_BLOCK) return;

    const dim = ev.block.dimension;
    const loc = cloneBlockLoc(ev.block.location);

    let half = "lower";

    try {
        half = ev.brokenBlockPermutation.getState("subo:half") ?? "lower";
    } catch { }

    queuePortalBreak(dim, loc, half);
});

export function handlePortalBreak(event) {
    const dim = event.block.dimension;
    const loc = cloneBlockLoc(event.block.location);

    let half = "lower";

    try {
        half = event.brokenBlockPermutation?.getState("subo:half") ?? "lower";
    } catch { }

    queuePortalBreak(dim, loc, half);
}