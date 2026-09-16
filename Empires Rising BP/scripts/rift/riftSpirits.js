import { system, world, ItemStack, BlockPermutation } from "@minecraft/server";
import { DIMENSION_ID } from "../config/riftConfig.js";
import {
    getNum, setNum, getPlayerRiftReturn, clearPlayerRiftTags
} from "./riftHelpers.js";
import { forceCloseRift, activeRifts } from "./riftPort.js";
import { returnPlayerHome } from "./riftTeleport.js";

// ────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────
export const SPIRIT_ITEMS = {
    vigor: "subo:vigor_spirit",
    pyro: "subo:pyro_spirit",
    frost: "subo:frost_spirit"
};

export const SPIRIT_ENTITIES = {
    vigor: "subo:vigor_spirit_entity",
    pyro: "subo:pyro_spirit_entity",
    frost: "subo:frost_spirit_entity"
};

export const PROJECTILE_ENTITY = "subo:pyro_spirit_projectile";

const SCORE_VIGOR = "spirit_vigor";
const SCORE_PYRO = "spirit_pyro";
const SCORE_FROST = "spirit_frost";

const MAX_LEVEL = 100;

// Runtime
const spiritLevels = new Map();   // playerId → {vigor, pyro, frost}
const activeSpirits = new Map();   // playerId → Set<Entity>
const activeProjectiles = new Map();
const activeFrostZones = [];       // {x,y,z, size, endTick, level, lastEffectTick}
const lastLightPos = new Map(); // spirit.id → {x,y,z, dim}
const vigorRepelCooldown = new Map(); // playerId → next available tick

const BOB_SPEED = 0.08;
const FOLLOW_DIST = 1.8;
const FOLLOW_HEIGHT = 1.6;

// ────────────────────────────────────────────────
//  Scoreboard + level helpers (capped at 100)
// ────────────────────────────────────────────────
function ensureScore(objName) {
    return world.scoreboard.getObjective(objName)
        ?? world.scoreboard.addObjective(objName, objName);
}

export function getSpiritLevel(player, type) {
    if (!player?.isValid) return 0;

    try {
        const obj = ensureScore(
            type === "vigor" ? SCORE_VIGOR :
                type === "pyro" ? SCORE_PYRO : SCORE_FROST
        );

        // Preferred modern way
        if (player.scoreboardIdentity) {
            return Math.min(MAX_LEVEL, obj.getScore(player.scoreboardIdentity) ?? 0);
        }

        // Fallback (very reliable)
        return Math.min(MAX_LEVEL, obj.getScore(player.name) ?? 0);
    } catch {
        return 0;
    }
}

export function addSpiritLevel(player, type, amount) {
    if (!player?.isValid || amount <= 0) return 0;

    try {
        const obj = ensureScore(
            type === "vigor" ? SCORE_VIGOR :
                type === "pyro" ? SCORE_PYRO : SCORE_FROST
        );

        let cur = 0;

        // Safe read
        try {
            if (player.scoreboardIdentity) {
                cur = obj.getScore(player.scoreboardIdentity) ?? 0;
            } else {
                cur = obj.getScore(player.name) ?? 0;
            }
        } catch {
            cur = 0;
        }

        const next = Math.min(MAX_LEVEL, cur + amount);

        // Safe write
        try {
            if (player.scoreboardIdentity) {
                obj.setScore(player.scoreboardIdentity, next);
            } else {
                obj.setScore(player.name, next);
            }
        } catch {
            // last resort
            try { obj.setScore(player.name, next); } catch { }
        }

        // Keep runtime cache in sync
        const levels = spiritLevels.get(player.id) ?? { vigor: 0, pyro: 0, frost: 0 };
        levels[type] = next;
        spiritLevels.set(player.id, levels);

        return next;
    } catch (e) {
        console.warn("[Spirit] addSpiritLevel failed", e);
        return 0;
    }
}

function loadPlayerLevels(player) {
    if (!player?.isValid) return { vigor: 0, pyro: 0, frost: 0 };
    const levels = {
        vigor: getSpiritLevel(player, "vigor"),
        pyro: getSpiritLevel(player, "pyro"),
        frost: getSpiritLevel(player, "frost")
    };
    spiritLevels.set(player.id, levels);
    return levels;
}

// ────────────────────────────────────────────────
//  Scaling helpers (level 1-100)
// ────────────────────────────────────────────────
function vigorHealAmount(lvl) {
    // starts at 2 HP (1 heart), scales up
    return 2 + Math.floor(lvl * 0.18);           // ~20 HP at 100
}
function vigorHealInterval(lvl) {
    return Math.max(200, 1200 - lvl * 10);       // 60s → 10s
}
function vigorRepelCooldownTicks(lvl) {
    return Math.max(80, 600 - lvl * 5);          // scales down
}
function vigorRepelForce(lvl) {
    return 1.2 + lvl * 0.015;                    // mild → strong
}

function pyroShootInterval(lvl) {
    return Math.max(10, 40 - Math.floor(lvl * 0.3));
}
function pyroDamage(lvl) {
    return 4 + Math.floor(lvl * 0.22);           // 4 → ~26
}
function pyroTargetCount(lvl) {
    return Math.min(6, 1 + Math.floor(lvl / 10)); // 1 → 6 (every 10 levels)
}

function frostAbilityInterval(lvl) {
    return Math.max(20, 100 - Math.floor(lvl * 0.7));
}
function frostDuration(lvl) {
    return 60 + Math.floor(lvl * 1.2);           // 3s → ~9s
}
function frostSize(lvl) {
    // starts as ~2×2, grows
    return 1.0 + Math.floor(lvl / 20) * 0.6;     // radius
}
function frostSlownessAmplifier(lvl) {
    return Math.min(4, 1 + Math.floor(lvl / 25));
}
function frostFireDamage(lvl) {
    if (lvl <= 5) return 0;
    return 2 + Math.floor(lvl / 8);              // only when >5
}
function frostLightLevel(lvl) {
    return Math.min(15, 4 + Math.floor(lvl / 7));
}

// ────────────────────────────────────────────────
//  Spawn / despawn
// ────────────────────────────────────────────────
export function spawnSpiritsForPlayer(player) {
    if (!player?.isValid || player.dimension.id !== DIMENSION_ID) return;
    despawnSpiritsForPlayer(player);


    const levels = loadPlayerLevels(player);
    const spawned = new Set();

    for (const [type, lvl] of Object.entries(levels)) {
        if (lvl <= 0) continue;
        try {
            const ent = player.dimension.spawnEntity(SPIRIT_ENTITIES[type], {
                x: player.location.x,
                y: player.location.y + 1.5,
                z: player.location.z
            });
            ent.addTag(`spirit_owner:${player.id}`);
            ent.addTag(`spirit_type:${type}`);
            ent.addTag(`spirit_level:${lvl}`);
            ent.addTag(`bob_phase:${Math.floor(Math.random() * 1000)}`);
            spawned.add(ent);
        } catch (e) {
            console.warn(`[Spirit] spawn ${type} failed`, e);
        }
    }
    if (spawned.size) activeSpirits.set(player.id, spawned);
}

export function despawnSpiritsForPlayer(player) {
    if (!player) return;
    const set = activeSpirits.get(player.id);
    if (set) {
        for (const e of set) {
            cleanupLight(e);
            try { if (e.isValid) e.remove(); } catch { }
        }
        activeSpirits.delete(player.id);
    }
    try {
        for (const e of world.getDimension(DIMENSION_ID).getEntities({
            tags: [`spirit_owner:${player.id}`]
        })) {
            cleanupLight(e);
            try { e.remove(); } catch { }
        }
    } catch { }
}

// ────────────────────────────────────────────────
//  Item use (right-click)
// ────────────────────────────────────────────────
export async function handleSpiritUse(player, item) {
    if (!player?.isValid || !item) return;

    // Spirits can only be consumed while inside the rift
    if (player.dimension.id !== DIMENSION_ID) {
        player.sendMessage("§cSpirits can only be consumed inside a Rift.");
        return;
    }

    let type = null;
    if (item.typeId === SPIRIT_ITEMS.vigor) type = "vigor";
    else if (item.typeId === SPIRIT_ITEMS.pyro) type = "pyro";
    else if (item.typeId === SPIRIT_ITEMS.frost) type = "frost";
    if (!type) return;
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return;

    // 1. Consume entire stack of this spirit type
    let consumed = 0;
    for (let i = 0; i < inv.size; i++) {
        const stack = inv.getItem(i);
        if (stack && stack.typeId === item.typeId) {
            consumed += stack.amount;
            inv.setItem(i, undefined);
        }
    }
    if (consumed <= 0) return;

    // 2. Permanent level-up
    const newLevel = addSpiritLevel(player, type, consumed);
    player.sendMessage(`§d${type.charAt(0).toUpperCase() + type.slice(1)} Spirit +${consumed} → Level ${newLevel}/100`);

    // 3. Only act as exit ticket if the player is actually inside a rift
    const returnData = getPlayerRiftReturn(player);
    if (!returnData || player.dimension.id !== DIMENSION_ID) {
        return; // just the level-up is enough
    }

    const riftId = returnData.riftId;
    const loc = { x: returnData.x, y: returnData.y, z: returnData.z };

    // 4. Count any remaining unopened glitch pouches this player is carrying
    //    and add them to the counter (so the last pouch can’t be “stolen”)
    let extraPouches = 0;
    for (let i = 0; i < inv.size; i++) {
        const stack = inv.getItem(i);
        if (stack && stack.typeId === "subo:glitch_pouch") {
            extraPouches += stack.amount;
            inv.setItem(i, undefined); // remove them – they are being accounted for
        }
    }

    // 5. Apply the extra pouches to the correct rift
    const dim = world.getDimension("minecraft:overworld");
    let entity = null;
    try {
        for (const e of dim.getEntities({ type: "subo:rift_port_entity" })) {
            if (getNum(e, "riftId:", 0) === riftId) {
                entity = e;
                break;
            }
        }
    } catch { }

    let needDestroy = false;
    if (entity?.isValid && extraPouches > 0) {
        const total = getNum(entity, "pouchTotal:", 0);
        let opened = getNum(entity, "pouchOpened:", 0) + extraPouches;
        setNum(entity, "pouchOpened:", opened);
        needDestroy = opened >= total && total > 0;

        if (extraPouches > 0) {
            player.sendMessage(`§7(${extraPouches} unopened pouch${extraPouches > 1 ? "es" : ""} accounted for)`);
        }
    }

    // 6. Decide who leaves with this player
    const playersToReturn = [player]; // always the user

    for (const p of world.getPlayers()) {
        if (p.id === player.id) continue;
        const data = getPlayerRiftReturn(p);
        if (!data || data.riftId !== riftId || p.dimension.id !== DIMENSION_ID) continue;

        // Check if this other player still has any spirits
        const otherInv = p.getComponent("minecraft:inventory")?.container;
        let hasSpirit = false;
        if (otherInv) {
            for (let i = 0; i < otherInv.size; i++) {
                const stack = otherInv.getItem(i);
                if (stack && (
                    stack.typeId === SPIRIT_ITEMS.vigor ||
                    stack.typeId === SPIRIT_ITEMS.pyro ||
                    stack.typeId === SPIRIT_ITEMS.frost
                )) {
                    hasSpirit = true;
                    break;
                }
            }
        }

        // Only force them out if they have zero spirits left
        if (!hasSpirit) {
            playersToReturn.push(p);
        }
    }

    // 7. Teleport everyone we decided to return
    for (const p of playersToReturn) {
        await returnPlayerHome(p, {
            dim: "overworld",
            x: loc.x,
            y: loc.y,
            z: loc.z
        });
        clearPlayerRiftTags(p);
        despawnSpiritsForPlayer(p);
    }

    // 8. If the extra pouches (or previous ones) completed the counter → destroy the port
    if (needDestroy) {
        await forceCloseRift(dim, entity, true, riftId, loc);
        // visual feedback only for the player who caused it
        try {
            dim.spawnParticle("minecraft:large_explosion", {
                x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5
            });
            dim.playSound("random.explode", loc, { volume: 1.1, pitch: 0.85 });
            const block = dim.getBlock(loc);
            if (block) block.setType("subo:destroyed_rift");
        } catch { }
    }
}

// ────────────────────────────────────────────────
//  Light helpers (frost only)
// ────────────────────────────────────────────────
function updateFrostLight(spirit, level) {
    if (!spirit?.isValid) return;
    const dim = spirit.dimension;
    const pos = {
        x: Math.floor(spirit.location.x),
        y: Math.floor(spirit.location.y),
        z: Math.floor(spirit.location.z)
    };
    const lightLvl = frostLightLevel(level);

    // clean previous light
    const prev = lastLightPos.get(spirit.id);
    if (prev && (prev.x !== pos.x || prev.y !== pos.y || prev.z !== pos.z)) {
        try {
            const b = prev.dim.getBlock(prev);
            if (b?.typeId === "minecraft:light_block") b.setType("minecraft:air");
        } catch { }
    }

    try {
        const block = dim.getBlock(pos);
        if (block && (block.isAir || block.typeId === "minecraft:light_block")) {
            block.setPermutation(
                BlockPermutation.resolve("minecraft:light_block", { "block_light_level": lightLvl })
            );
            lastLightPos.set(spirit.id, { ...pos, dim });
        }
    } catch { }
}

function cleanupLight(spirit) {
    if (!spirit) return;
    const prev = lastLightPos.get(spirit.id);
    if (prev) {
        try {
            const b = prev.dim.getBlock(prev);
            if (b?.typeId === "minecraft:light_block") b.setType("minecraft:air");
        } catch { }
        lastLightPos.delete(spirit.id);
    }
}

// ────────────────────────────────────────────────
//  Main ticker
// ────────────────────────────────────────────────
let spiritTickerId = null;

export function startSpiritTicker() {
    if (spiritTickerId !== null) return;

    // Vigor repel on damage
    world.afterEvents.entityHurt.subscribe((ev) => {
        const player = ev.hurtEntity;
        if (!player || player.typeId !== "minecraft:player") return;
        if (player.dimension.id !== DIMENSION_ID) return;

        const levels = spiritLevels.get(player.id) ?? loadPlayerLevels(player);
        if (levels.vigor <= 20) return;

        const now = system.currentTick;
        const next = vigorRepelCooldown.get(player.id) ?? 0;
        if (now < next) return;

        // find nearby monsters
        const monsters = player.dimension.getEntities({
            location: player.location,
            maxDistance: 6,
            excludeTypes: ["minecraft:player", "minecraft:item", "minecraft:xp_orb",
                ...Object.values(SPIRIT_ENTITIES), PROJECTILE_ENTITY]
        }).filter(e => e.isValid);

        if (monsters.length === 0) return;

        const force = vigorRepelForce(levels.vigor);
        for (const m of monsters) {
            try {
                const dx = m.location.x - player.location.x;
                const dz = m.location.z - player.location.z;
                m.applyKnockback(dx, dz, force, 0.35);
            } catch { }
        }
        player.dimension.spawnParticle("minecraft:critical_hit_emitter", player.location);
        vigorRepelCooldown.set(player.id, now + vigorRepelCooldownTicks(levels.vigor));
    });

    spiritTickerId = system.runInterval(() => {
        const now = system.currentTick;
        const dim = world.getDimension(DIMENSION_ID);

        // ── clean dead spirits ──
        for (const [pid, set] of activeSpirits) {
            for (const e of [...set]) {
                if (!e.isValid) {
                    cleanupLight(e);
                    set.delete(e);
                }
            }
            if (set.size === 0) activeSpirits.delete(pid);
        }

        // ── process every living spirit ──
        for (const [pid, set] of activeSpirits) {
            const player = world.getPlayers().find(p => p.id === pid);
            if (!player?.isValid || player.dimension.id !== DIMENSION_ID) {
                for (const e of set) { cleanupLight(e); try { e.remove(); } catch { } }
                activeSpirits.delete(pid);
                continue;
            }

            const levels = spiritLevels.get(pid) ?? loadPlayerLevels(player);

            for (const spirit of set) {
                if (!spirit.isValid) continue;
                const typeTag = [...spirit.getTags()].find(t => t.startsWith("spirit_type:"));
                const type = typeTag ? typeTag.slice(12) : null;
                if (!type) continue;

                const level = levels[type] || 1;
                const phase = Number(([...spirit.getTags()].find(t => t.startsWith("bob_phase:")) || "0").replace("bob_phase:", ""));

                // shared bob (never static)
                const bobY = Math.sin((now + phase) * BOB_SPEED) * 0.25;
                const bobX = Math.sin((now + phase) * BOB_SPEED * 0.7) * 0.15;
                const bobZ = Math.cos((now + phase) * BOB_SPEED * 0.9) * 0.15;

                // ── VIGOR ──
                if (type === "vigor") {
                    const yaw = player.getRotation().y * Math.PI / 180;
                    const target = {
                        x: player.location.x - Math.sin(yaw) * FOLLOW_DIST + bobX,
                        y: player.location.y + FOLLOW_HEIGHT + bobY,
                        z: player.location.z + Math.cos(yaw) * FOLLOW_DIST + bobZ
                    };
                    try { spirit.teleport(target, { checkForBlocks: false }); } catch { }

                    const interval = vigorHealInterval(level);
                    if (now % interval === 0) {
                        try {
                            const health = player.getComponent("minecraft:health");
                            if (health && health.currentValue < health.effectiveMax) {
                                const amount = vigorHealAmount(level);
                                health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + amount));
                                player.dimension.spawnParticle("minecraft:heart_particle", {
                                    x: player.location.x, y: player.location.y + 1, z: player.location.z
                                });
                            }
                        } catch { }
                    }
                }

                // ── PYRO ──
                else if (type === "pyro") {
                    const yaw = player.getRotation().y * Math.PI / 180;
                    const orbit = Math.sin((now + phase) * 0.05) * 0.4;
                    const target = {
                        x: player.location.x - Math.sin(yaw) * FOLLOW_DIST + bobX + Math.cos(yaw) * orbit,
                        y: player.location.y + FOLLOW_HEIGHT + bobY,
                        z: player.location.z + Math.cos(yaw) * FOLLOW_DIST + bobZ + Math.sin(yaw) * orbit
                    };
                    try { spirit.teleport(target, { checkForBlocks: false }); } catch { }

                    const interval = pyroShootInterval(level);
                    if (now % interval === 0) {
                        firePyroProjectiles(spirit, player, level);
                    }
                }

                // ── FROST ──
                else if (type === "frost") {
                    // hang near nearest monster (or player)
                    const monsters = dim.getEntities({
                        location: player.location,
                        maxDistance: 24,
                        excludeTypes: ["minecraft:player", "minecraft:item", "minecraft:xp_orb",
                            ...Object.values(SPIRIT_ENTITIES), PROJECTILE_ENTITY]
                    }).filter(e => e.isValid);

                    let targetEnt = null;
                    let best = Infinity;
                    for (const m of monsters) {
                        const d = distSq(m.location, player.location);
                        if (d < best) { best = d; targetEnt = m; }
                    }

                    const tLoc = targetEnt ? targetEnt.location : player.location;
                    const target = {
                        x: tLoc.x + bobX * 2.2,
                        y: tLoc.y + 1.3 + bobY,
                        z: tLoc.z + bobZ * 2.2
                    };
                    try { spirit.teleport(target, { checkForBlocks: false }); } catch { }

                    // light
                    if (now % 8 === 0) updateFrostLight(spirit, level);

                    // frost zone ability
                    const interval = frostAbilityInterval(level);
                    if (now % interval === 0) {
                        const size = frostSize(level);
                        activeFrostZones.push({
                            x: spirit.location.x,
                            y: spirit.location.y,
                            z: spirit.location.z,
                            size,
                            endTick: now + frostDuration(level),
                            level,
                            lastEffectTick: 0
                        });
                    }
                }
            }
        }

        // ── Frost zones ──
        for (let i = activeFrostZones.length - 1; i >= 0; i--) {
            const zone = activeFrostZones[i];
            if (now >= zone.endTick) {
                activeFrostZones.splice(i, 1);
                continue;
            }

            // particles
            if (now % 4 === 0) {
                try {
                    dim.spawnParticle("minecraft:snowflake_particle", {
                        x: zone.x + (Math.random() - 0.5) * zone.size * 2,
                        y: zone.y + Math.random() * 1.5,
                        z: zone.z + (Math.random() - 0.5) * zone.size * 2
                    });
                } catch { }
            }

            // effects every second
            if (now - zone.lastEffectTick >= 20) {
                zone.lastEffectTick = now;
                const ents = dim.getEntities({
                    location: { x: zone.x, y: zone.y, z: zone.z },
                    maxDistance: zone.size + 0.5
                });

                const amp = frostSlownessAmplifier(zone.level);
                const fireDmg = frostFireDamage(zone.level);

                for (const e of ents) {
                    if (!e.isValid || e.typeId === "minecraft:player") continue;
                    try {
                        e.addEffect("slowness", 30, { amplifier: amp, showParticles: true });
                    } catch { }

                    // extra damage to fire-related mobs when level > 5
                    if (fireDmg > 0 && (
                        e.typeId === "minecraft:magma_cube" ||
                        e.typeId === "minecraft:blaze" ||
                        e.typeId === "subo:fire_spirit"
                    )) {
                        try { e.applyDamage(fireDmg, { cause: "magic" }); } catch { }
                    }
                }
            }
        }

        // ── Projectiles (curved + tagged damage) ──
        for (const [proj, data] of [...activeProjectiles]) {
            if (!proj.isValid) {
                activeProjectiles.delete(proj);
                continue;
            }
            const target = world.getEntity(data.targetId);
            if (!target?.isValid) {
                try { proj.remove(); } catch { }
                activeProjectiles.delete(proj);
                continue;
            }

            const t = Math.min(1, (now - data.startTick) / 12);
            const p0 = data.startPos, p1 = data.controlPos, p2 = target.location;
            const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
            const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
            const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * p1.z + t * t * p2.z;

            try { proj.teleport({ x, y, z }, { checkForBlocks: false }); } catch { }

            if (distSq({ x, y, z }, target.location) < 1.3) {
                try {
                    target.applyDamage(data.damage, { cause: "magic" });
                    target.applyKnockback(x - target.location.x, z - target.location.z, 0.45, 0.3);
                    target.setOnFire(1, true);
                    proj.dimension.spawnParticle("minecraft:basic_flame_particle", target.location);
                } catch { }
                try { proj.remove(); } catch { }
                activeProjectiles.delete(proj);
            }
        }
    }, 2);
}

// ────────────────────────────────────────────────
//  Pyro multi-target shooting
// ────────────────────────────────────────────────
function firePyroProjectiles(spirit, player, level) {
    const dim = spirit.dimension;
    const count = pyroTargetCount(level);
    const dmg = pyroDamage(level);

    const candidates = dim.getEntities({
        location: spirit.location,
        maxDistance: 16,
        excludeTypes: ["minecraft:player", "minecraft:item", "minecraft:xp_orb",
            ...Object.values(SPIRIT_ENTITIES), PROJECTILE_ENTITY]
    }).filter(e => e.isValid);

    // sort by distance + simple LOS
    const valid = [];
    for (const m of candidates) {
        const d = distSq(m.location, spirit.location);
        const dir = {
            x: m.location.x - spirit.location.x,
            y: m.location.y - spirit.location.y,
            z: m.location.z - spirit.location.z
        };
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
        dir.x /= len; dir.y /= len; dir.z /= len;
        try {
            const hit = dim.getBlockFromRay(spirit.location, dir, { maxDistance: Math.sqrt(d) });
            if (hit?.block && !hit.block.isAir) continue;
        } catch { continue; }
        valid.push({ ent: m, dist: d });
    }
    valid.sort((a, b) => a.dist - b.dist);

    for (let i = 0; i < Math.min(count, valid.length); i++) {
        const target = valid[i].ent;
        let proj;
        try {
            proj = dim.spawnEntity(PROJECTILE_ENTITY, spirit.location);
        } catch { continue; }

        // tag damage for clarity (also stored in map)
        proj.addTag(`damage:${dmg}`);

        const mid = {
            x: (spirit.location.x + target.location.x) / 2,
            y: Math.max(spirit.location.y, target.location.y) + 2.5 + Math.random() * 2,
            z: (spirit.location.z + target.location.z) / 2
        };
        const dx = target.location.x - spirit.location.x;
        const dz = target.location.z - spirit.location.z;
        mid.x += -dz * 0.35;
        mid.z += dx * 0.35;

        activeProjectiles.set(proj, {
            targetId: target.id,
            startTick: system.currentTick,
            startPos: { ...spirit.location },
            controlPos: mid,
            damage: dmg
        });
    }
}

function distSq(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

// ────────────────────────────────────────────────
//  Recovery
// ────────────────────────────────────────────────
export function recoverSpirits() {
    for (const p of world.getPlayers()) {
        if (p.dimension.id === DIMENSION_ID) {
            loadPlayerLevels(p);
            console.warn("spawn spirits");

            spawnSpiritsForPlayer(p);
        }
    }
}