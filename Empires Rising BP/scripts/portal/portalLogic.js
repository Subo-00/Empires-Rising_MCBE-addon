import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";
import { ACTIVE_SECONDS, TROOP_RADIUS } from "../config/itemsConfig.js";
import { RIFT_DIMENSION_ID } from "../config/rift/riftConfig.js";
import { getStorageLocation, setTag, getTag, isTroop } from "../spawner/spawnerHelpers.js"; getPortalNameColor
import { forceNearbyTroopsStay, restoreNearbyTroops } from "../sharedHelpers/troopTeleport.js";
import {
    PORTAL_BLOCK, PORTAL_ENTITY,
    BASE_MARKER, NAME_MARKER, LIST_MARKER,
    getPlayerPortals, setPlayerPortals, addPlayerPortal, removePlayerPortalById,
    getPortalEntity, findPortalAt, portalDataFromEntity, removePortalEntity,
    getLowerPortalBlock, setActive, playExpandParticle, tryGivePortalItem,
    cloneBlockLoc, portalKeyFromLoc, lowerLocFromBrokenHalf,
    getPortalNameColor
} from "./portalHelpers.js";

// Active portals: Map<"dim:x:y:z", { dest, expireTick, activator }>
const activePortals = new Map();
let portalTickId = null;

const formOpenPlayers = new Set();

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

// When a portal entity loads (chunk reload, dimension change, server start, etc.)
// → always force it closed. A portal that was unloaded should never stay visually open.
world.afterEvents.entityLoad.subscribe((ev) => {
    const e = ev.entity;
    if (e.typeId !== PORTAL_ENTITY) return;

    // Run next tick so tags / location are fully available
    system.run(() => {
        if (!e.isValid) return;

        // Clear any leftover timer tag
        for (const t of [...e.getTags()]) {
            if (t.startsWith("activeUntil:")) e.removeTag(t);
        }

        const loc = {
            x: Number(getTag(e, "x:", 0)),
            y: Number(getTag(e, "y:", 0)),
            z: Number(getTag(e, "z:", 0))
        };

        // Prefer the dimension stored on the entity, fall back to current
        let dimId = (getTag(e, "dim:", "") || "").replace("_", ":");
        if (!dimId) dimId = e.dimension.id;

        try {
            const lower = world.getDimension(dimId).getBlock(loc);
            if (lower?.typeId === PORTAL_BLOCK) {
                setActive(lower, false);
            }
        } catch { /* chunk may still be settling */ }

        // Also drop it from the in-memory map
        const key = `${dimId}|${Math.floor(loc.x)}|${Math.floor(loc.y)}|${Math.floor(loc.z)}`;
        activePortals.delete(key);
    });
});

// ===== Placement → name prompt =====
world.afterEvents.playerPlaceBlock.subscribe(async (ev) => {
    if (ev.block.typeId !== PORTAL_BLOCK) return;
    const player = ev.player;

    // NEW – refuse any portal placement inside a rift
    if (player.dimension.id === RIFT_DIMENSION_ID) {
        // Remove both halves without dropping items
        removePortalBlocksNoDrop(ev.block.dimension, ev.block.location);
        // Give exactly one portal item back
        tryGivePortalItem(player);
        player.onScreenDisplay.setActionBar("§cYou cannot place a portal inside a rift.");
        return;
    }

    const lower = ev.block;
    const dim = lower.dimension;
    let facing = lower.permutation.getState("minecraft:cardinal_direction") || "north";


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
        .title(BASE_MARKER + NAME_MARKER + "§uName Your Portal")
        .textField("Portal name (must be unique for you)", "e.g. Home Base");

    const response = await form.show(player);
    if (response.canceled || !response.formValues?.[0]?.trim()) {
        tryGivePortalItem(player);
        removePortalBlocksNoDrop(dim, lower.location);
        player.sendMessage("§cPortal naming cancelled.");
        return;
    }

    let name = response.formValues[0].trim();

    // Player is not allowed to put § in the name
    if (name.includes("§")) {
        tryGivePortalItem(player);
        removePortalBlocksNoDrop(dim, lower.location);
        player.sendMessage("§cPortal name cannot contain the § character.");
        return;
    }

    const existing = getPlayerPortals(player);
    // Compare without color codes so uniqueness is based on the text the player typed
    if (existing.some(p => p.name.replace(/§./g, "").toLowerCase() === name.toLowerCase())) {
        tryGivePortalItem(player);
        removePortalBlocksNoDrop(dim, lower.location);
        player.sendMessage("§cYou already have a portal named that!");
        return;
    }

    // Prepend biome color
    const color = getPortalNameColor(dim, lower.location);
    name = color + name;

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

            addPlayerPortal(player, {
                id,
                name,
                x: lower.location.x,
                y: lower.location.y,
                z: lower.location.z,
                dim: dim.id,
                facing
            });
        }
    });

    player.sendMessage(`§aPortal "${name}§a" created!`);
});

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

    const myPortals = getPlayerPortals(player);
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
        .title(
            BASE_MARKER + LIST_MARKER +
            "§d        PORTAL:      \n" +
            padCenter(found.portal.name, 21)
        )
        .dropdown("§l§uDestination", choices.map(p => p.name), { defaultValueIndex: 0 })
        .toggle("§uBring this portal with me", { defaultValue: false });

    form.show(player).then((response) => {
        if (response.canceled || !response.formValues) return;

        const destIndex = response.formValues[0];
        const bringPortal = response.formValues[1];
        const dest = choices[destIndex];

        activatePortal(lower, dest, player, bringPortal); // Passing the lower block
    });
}
function padCenter(text, width = 22) {
    const clean = text.replace(/§./g, "");
    const pad = Math.max(0, Math.floor((width - clean.length) / 2));
    return " ".repeat(pad) + clean;
}

function unregisterPortal(found) {
    if (!found) return;

    // Update owner’s tag only if they are currently online
    const online = world.getPlayers().find(p => p.name === found.owner);
    if (online) removePlayerPortalById(online, found.portal.id);

    if (found.entity) removePortalEntity(found.entity);
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

    activator.sendMessage(`§aPortal open to "${dest.name}§a" for ${ACTIVE_SECONDS} seconds!`);
    lower.dimension.playSound("portal.trigger", lower.location, { volume: 1, pitch: 1 });
    playExpandParticle(lower.dimension, {
        x: lower.location.x + 0.5,
        y: lower.location.y,
        z: lower.location.z + 0.5
    }, 20, TROOP_RADIUS);
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
                const FACING_OFFSET = {
                    north: { x: 0, z: -1.2 },
                    south: { x: 0, z: 1.2 },
                    west: { x: -1.2, z: 0 },
                    east: { x: 1.2, z: 0 }
                };

                const off = FACING_OFFSET[data.dest.facing] ?? { x: 0, z: 0 };

                const destLoc = {
                    x: data.dest.x + 0.5 - off.x,
                    y: data.dest.y + 0.05,
                    z: data.dest.z + 0.5 - off.z
                };

                let needDropPortal = false;

                if (data.bringPortal && player.name === data.activatorName) {
                    const lower = dim.getBlock({ x: +sx, y: +sy, z: +sz });
                    const found = lower ? findPortalAt(lower) : null;
                    if (found) {
                        const online = world.getPlayers().find(p => p.name === found.owner);
                        if (online) removePlayerPortalById(online, found.portal.id);
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

                // Fully deactivate the DESTINATION portal as soon as someone arrives
                {
                    const destKey = `${data.dest.dim}|${Math.floor(data.dest.x)}|${Math.floor(data.dest.y)}|${Math.floor(data.dest.z)}`;

                    // Remove from the live timer map
                    activePortals.delete(destKey);

                    try {
                        const destLower = destDim.getBlock({
                            x: Math.floor(data.dest.x),
                            y: Math.floor(data.dest.y),
                            z: Math.floor(data.dest.z)
                        });

                        if (destLower?.typeId === PORTAL_BLOCK) {
                            setActive(destLower, false);          // visual off

                            const destEnt = getPortalEntity(destLower);
                            if (destEnt) {
                                // clear any remaining timer tag
                                for (const t of [...destEnt.getTags()]) {
                                    if (t.startsWith("activeUntil:")) destEnt.removeTag(t);
                                }
                            }
                        }
                    } catch { /* destination chunk may not be fully ready yet */ }
                }

                const isSameDimension = dimId === data.dest.dim;

                if (true) {
                    // Same-dimension: collect the following troops so we can move them with the player
                    const troopsToBring = [];

                    const nearby = dim.getEntities({
                        location: portalLoc,
                        maxDistance: TROOP_RADIUS
                    });

                    for (const ent of nearby) {
                        if (!isTroop(ent.typeId)) continue;

                        const ownerTag = ent.getTags().find(t => t.startsWith("owner:"));
                        if (!ownerTag || ownerTag !== `owner:${player.name}`) continue;

                        const mark = ent.getComponent("minecraft:mark_variant");
                        if (!mark || mark.value !== 1) continue;

                        troopsToBring.push(ent);
                    }

                    try {

                        // Bring the troops
                        for (const ent of troopsToBring) {
                            if (!ent.isValid) continue;
                            ent.teleport(destLoc, { dimension: destDim });
                        }

                        system.runTimeout(() => {
                            player.sendMessage(`§bTeleported to "${data.dest.name}§b"`);
                            player.teleport(destLoc, { dimension: destDim });
                        }, 1);

                        if (needDropPortal) {
                            system.runTimeout(() => {
                                try {
                                    player.dimension.spawnItem(new ItemStack("subo:portal", 1), player.location);
                                    player.sendMessage("§eInventory full – portal dropped at your feet.");
                                } catch { }
                            }, 10);
                        }

                        // 0.5 seconds later: snap back if the game put the player too far away
                        system.runTimeout(() => {
                            if (!player.isValid) return;
                            try {
                                const pos = player.location;
                                const dx = pos.x - destLoc.x;
                                const dy = pos.y - destLoc.y;
                                const dz = pos.z - destLoc.z;
                                const distSq = dx * dx + dy * dy + dz * dz;

                                if (distSq > 0.5) {   // > 1 block
                                    player.teleport(destLoc, { dimension: destDim });
                                }
                            } catch { }
                        }, 10);

                        // Nudge troops 3 ticks later – forces client entity update so the owner can see them
                        for (const ent of troopsToBring) {
                            if (!ent.isValid) continue;
                            ent.teleport(destLoc, { dimension: destDim });
                        }

                    } catch { }



                    // // Bring the troops a few ticks AFTER the player has arrived
                    // system.runTimeout(() => {
                    //     for (const ent of troopsToBring) {
                    //         if (!ent.isValid) continue;
                    //         console.warn("terleporting troop");


                    //         try {
                    //             ent.teleport(destLoc, { dimension: destDim });

                    //             // Nudge 3 ticks later – forces client entity update so the owner can see them
                    //             system.runTimeout(() => {
                    //                 if (!ent.isValid) return;
                    //                 try {
                    //                     ent.teleport(destLoc, { dimension: destDim });
                    //                 } catch { }
                    //             }, 3);
                    //         } catch { }
                    //     }
                    // }, 1);   // 5 ticks after the player teleport
                }

                else {
                    // Cross-dimension: leave troops behind
                    forceNearbyTroopsStay(player, TROOP_RADIUS);

                    system.runTimeout(() => {
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

                            // 0.5 seconds later: snap back if the game put the player too far away
                            system.runTimeout(() => {
                                if (!player.isValid) return;
                                try {
                                    const pos = player.location;
                                    const dx = pos.x - destLoc.x;
                                    const dy = pos.y - destLoc.y;
                                    const dz = pos.z - destLoc.z;
                                    const distSq = dx * dx + dy * dy + dz * dz;

                                    if (distSq > 0.5) {   // > 1 block
                                        player.teleport(destLoc, { dimension: destDim });
                                    }
                                } catch { }
                            }, 10);

                        } catch { }

                        // Resume any troops that were previously left at this destination
                        restoreNearbyTroops(player, TROOP_RADIUS);
                    }, 2);
                }

            }
        }

        if (activePortals.size === 0) {
            system.clearRun(portalTickId);
            portalTickId = null;
        }
    }, 5);
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