import { system, world, ItemStack, BlockPermutation } from "@minecraft/server";
import {
    RIFT_DIMENSION_ID
} from "../config/rift/riftConfig.js";
import {
    MAX_LEVEL,
    BOB_SPEED,
    FOLLOW_DIST,
    FOLLOW_HEIGHT,
    SPIRIT_ITEMS,
    SPIRIT_ENTITIES,
    PYRO_PROJECTILE_ENTITY,
    CLOSE_PRIORITY_DIST_SQ,
    pyroTargetRange,
    frostTargetRange,
    FROST_SWITCH_SPEED,
    FROST_FOLLOW_SPEED,
    FROST_ARC_STRENGTH,
    // Vigor
    vigorHealAmount,
    vigorHealInterval,
    vigorRepelCooldownTicks,
    vigorRepelForce,
    vigorRepelRadius,
    vigorRepelUpward,
    // Pyro
    pyroShootInterval,
    pyroDamage,
    pyroTargetCount,
    pyroKnockbackHorizontal,
    pyroKnockbackVertical,
    pyroBurnSeconds,
    // Frost
    frostAbilityInterval,
    frostDuration,
    frostSize,
    frostSlownessAmplifier,
    frostSlownessDuration,
    frostFireDamage,
    frostLightLevel,
    FROST_HOVER_HEIGHT,
    FROST_SIDE_OFFSET,
    FROST_SPIRAL_SPEED,
    FROST_SPIRAL_RADIUS
} from "../config/rift/spiritsConfig.js";
import {
    getNum, setNum, getPlayerRiftReturn, clearPlayerRiftTags
} from "./riftHelpers.js";
import { returnPlayerHome } from "./riftTeleport.js";

// ────────────────────────────────────────────────
//  Constants
// ────────────────────────────────────────────────

const SCORE_VIGOR = "spirit_vigor";
const SCORE_PYRO = "spirit_pyro";
const SCORE_FROST = "spirit_frost";

// Runtime
const spiritLevels = new Map();   // playerId → {vigor, pyro, frost}
const activeSpirits = new Map();   // playerId → Set<Entity>
const activeProjectiles = new Map();
const activeFrostZones = [];       // {x,y,z, size, endTick, level, lastEffectTick}
const lastLightPos = new Map(); // spirit.id → {x,y,z, dim}
const vigorRepelCooldown = new Map(); // playerId → next available tick
const frostHoverState = new Map(); // spirit.id → { x, y, z, targetId }

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
    if (!player?.isValid) return 0;

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

        const next = Math.max(0, Math.min(MAX_LEVEL, cur + amount));

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
//  Spawn / despawn
// ────────────────────────────────────────────────
export function spawnSpiritsForPlayer(player) {
    if (!player?.isValid || player.dimension.id !== RIFT_DIMENSION_ID) return;
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
            frostHoverState.delete(e.id);
            try { if (e.isValid) e.remove(); } catch { }
        }
        activeSpirits.delete(player.id);
    }
    try {
        for (const e of world.getDimension(RIFT_DIMENSION_ID).getEntities({
            tags: [`spirit_owner:${player.id}`]
        })) {
            cleanupLight(e);
            try { e.remove(); } catch { }
        }
    } catch { }
}

/**
 * Spirit-consume exit animation:
 * 1. Ensure the chosen spirit exists (spawn if missing)
 * 2. Float it to eye level directly in front of the player
 * 3. Spin around the player 2 full circles
 * 4. Flash + remove all spirits
 */
async function playSpiritExitAnimation(player, type) {
    if (!player?.isValid) return;

    const dim = player.dimension;
    const levels = spiritLevels.get(player.id) ?? loadPlayerLevels(player);
    const level = levels[type] || 1;

    // 1. Make sure the spirit of this type is present
    let spirit = null;
    const set = activeSpirits.get(player.id);
    if (set) {
        for (const e of set) {
            if (!e.isValid) continue;
            const t = [...e.getTags()].find(tag => tag.startsWith("spirit_type:"));
            if (t && t.slice(12) === type) {
                spirit = e;
                break;
            }
        }
    }

    if (!spirit) {
        try {
            spirit = dim.spawnEntity(SPIRIT_ENTITIES[type], {
                x: player.location.x,
                y: player.location.y + 1.6,
                z: player.location.z
            });
            spirit.addTag(`spirit_owner:${player.id}`);
            spirit.addTag(`spirit_type:${type}`);
            spirit.addTag(`spirit_level:${level}`);
            spirit.addTag(`temp_exit:1`);
        } catch {
            return;
        }
    }

    // Feedback: start
    try {
        dim.spawnParticle("subo:spirit_consume_start", {
            x: player.location.x, y: player.location.y + 1.5, z: player.location.z
        });
        player.playSound("subo.spirit.consume", { volume: 0.85, pitch: 1.0 });
    } catch { }

    // 2. Float to eye level, slightly in front 
    const eyeY = player.location.y + 1.62;
    const yaw = player.getRotation().y * Math.PI / 180;
    const front = {
        x: player.location.x - Math.sin(yaw) * 1.4,
        y: eyeY,
        z: player.location.z + Math.cos(yaw) * 1.4
    };

    for (let i = 1; i <= 8; i++) {
        if (!spirit.isValid || !player.isValid) return;
        const t = i / 8;
        const pos = {
            x: spirit.location.x + (front.x - spirit.location.x) * t,
            y: spirit.location.y + (front.y - spirit.location.y) * t,
            z: spirit.location.z + (front.z - spirit.location.z) * t
        };
        try { spirit.teleport(pos, { checkForBlocks: false }); } catch { }
        await system.waitTicks(1);
    }


    // 3. Spin around the player twice (24 steps)
    const radius = 1.35;
    const totalSteps = 36;
    const fullCircles = 3;
    for (let i = 0; i < totalSteps; i++) {
        if (!spirit.isValid || !player.isValid) return;

        const angle = (i / totalSteps) * Math.PI * 2 * fullCircles + yaw;
        const pos = {
            x: player.location.x + Math.sin(angle) * radius,
            y: eyeY + Math.sin(i * 0.4) * 0.15,
            z: player.location.z - Math.cos(angle) * radius
        };
        try { spirit.teleport(pos, { checkForBlocks: false }); } catch { }

        if (i % 3 === 0) {
            try { dim.spawnParticle("subo:spirit_spin", pos); } catch { }
        }
        if (i === 6 || i === 18) {
            try { player.playSound("subo.spirit.spin", { volume: 0.4, pitch: 1.0 }); } catch { }
        }
        await system.waitTicks(1);
    }

    // 4. Final flash + remove ALL spirits
    try {
        dim.spawnParticle("subo:spirit_exit", {
            x: player.location.x, y: eyeY, z: player.location.z
        });
        player.playSound("subo.spirit.exit", { volume: 0.95, pitch: 1.1 });
    } catch { }

    await system.waitTicks(4);
    despawnSpiritsForPlayer(player);
}

// ────────────────────────────────────────────────
//  Item use (right-click)
// ────────────────────────────────────────────────
export async function handleSpiritUse(player, item) {
    if (!player?.isValid || !item) return;

    // Spirits can only be consumed while inside the rift
    if (player.dimension.id !== RIFT_DIMENSION_ID) {
        player.sendMessage("§cSpirits can only be consumed inside a Rift.");
        return;
    }

    // Block if the player still has any Glitch Pouches – they must be extracted first
    const invCheck = player.getComponent("minecraft:inventory")?.container;
    if (invCheck) {
        for (let i = 0; i < invCheck.size; i++) {
            const stack = invCheck.getItem(i);
            if (stack && stack.typeId === "subo:glitch_pouch") {
                player.sendMessage("§cExtract all Glitch Pouches before consuming spirits.");
                return;
            }
        }
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
    player.sendMessage(`§d${type.charAt(0).toUpperCase() + type.slice(1)} Spirit +${consumed} → Level ${newLevel}/${MAX_LEVEL}`);

    // 3. Only act as exit ticket if the player is actually inside a rift
    const returnData = getPlayerRiftReturn(player);
    if (!returnData || player.dimension.id !== RIFT_DIMENSION_ID) {
        return; // just the level-up is enough
    }

    const riftId = returnData.riftId;
    const loc = { x: returnData.x, y: returnData.y, z: returnData.z };

    // ─── Spirit Exit Animation ───────────────────────────────────────────────
    await playSpiritExitAnimation(player, type);

    // 4. Decide who leaves with this player
    const playersToReturn = [player]; // always the user

    for (const p of world.getPlayers()) {
        if (p.id === player.id) continue;
        const data = getPlayerRiftReturn(p);
        if (!data || data.riftId !== riftId || p.dimension.id !== RIFT_DIMENSION_ID) continue;

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

    // 5. Teleport everyone we decided to return
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

    // Always remove previous light first (guarantees ≤1 light per spirit)
    const prev = lastLightPos.get(spirit.id);
    if (prev) {
        try {
            const b = prev.dim.getBlock(prev);
            if (b?.typeId.includes("minecraft:light_block")) b.setType("minecraft:air");
        } catch { }
        lastLightPos.delete(spirit.id);
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

/** Remove every pyro projectile that is not currently tracked (covers reboot leftovers + desyncs). */
function cleanupOrphanProjectiles() {
    try {
        const dim = world.getDimension(RIFT_DIMENSION_ID);
        for (const e of dim.getEntities({ type: PYRO_PROJECTILE_ENTITY })) {
            if (!activeProjectiles.has(e)) {
                try { e.remove(); } catch { }
            }
        }
    } catch { }
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
        if (player.dimension.id !== RIFT_DIMENSION_ID) return;

        const levels = spiritLevels.get(player.id) ?? loadPlayerLevels(player);
        if (levels.vigor <= 20) return;

        const now = system.currentTick;
        const next = vigorRepelCooldown.get(player.id) ?? 0;
        if (now < next) return;

        const radius = vigorRepelRadius(levels.vigor);
        const force = vigorRepelForce(levels.vigor);
        const upward = vigorRepelUpward(levels.vigor);

        const monsters = player.dimension.getEntities({
            location: player.location,
            maxDistance: radius,
            families: ["monster"]
        });

        if (monsters.length === 0) return;

        for (const m of monsters) {
            try {
                const dx = m.location.x - player.location.x;
                const dz = m.location.z - player.location.z;
                const len = Math.sqrt(dx * dx + dz * dz) || 1;

                m.applyImpulse({
                    x: (dx / len) * force,
                    y: upward,
                    z: (dz / len) * force
                });
            } catch { }
        }

        // Feedback
        player.dimension.spawnParticle("subo:vigor_repel", player.location);
        try { player.playSound("subo.vigor.repel", { volume: 0.8, pitch: 0.95 }); } catch { }

        vigorRepelCooldown.set(player.id, now + vigorRepelCooldownTicks(levels.vigor));
    });

    spiritTickerId = system.runInterval(() => {
        const now = system.currentTick;
        const dim = world.getDimension(RIFT_DIMENSION_ID);

        // ── clean dead spirits ──
        for (const [pid, set] of activeSpirits) {
            for (const e of [...set]) {
                if (!e.isValid) {
                    cleanupLight(e);
                    frostHoverState.delete(e.id);
                    set.delete(e);
                }
            }
            if (set.size === 0) activeSpirits.delete(pid);
        }

        // Periodic orphan projectile sweep (every 5 s)
        if (now % 100 === 0) {
            cleanupOrphanProjectiles();
        }

        // ── process every living spirit ──
        for (const [pid, set] of activeSpirits) {
            const player = world.getPlayers().find(p => p.id === pid);
            if (!player?.isValid || player.dimension.id !== RIFT_DIMENSION_ID) {
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
                        x: player.location.x + Math.sin(yaw) * FOLLOW_DIST + bobX,
                        y: player.location.y + FOLLOW_HEIGHT + bobY,
                        z: player.location.z - Math.cos(yaw) * FOLLOW_DIST + bobZ
                    };
                    try { spirit.teleport(target, { checkForBlocks: false }); } catch { }

                    const interval = vigorHealInterval(level);
                    if (now % interval === 0) {
                        try {
                            const health = player.getComponent("minecraft:health");
                            if (health && health.currentValue < health.effectiveMax) {
                                const amount = vigorHealAmount(level);
                                health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + amount));
                                player.dimension.spawnParticle("subo:vigor_heal", {
                                    x: player.location.x, y: player.location.y + 1, z: player.location.z
                                });
                                try { player.playSound("subo.vigor.heal", { volume: 0.45, pitch: 1.1 }); } catch { }
                            }
                        } catch { }
                    }
                }

                // ── PYRO ──
                else if (type === "pyro") {
                    const yaw = player.getRotation().y * Math.PI / 180;
                    const orbit = Math.sin((now + phase) * 0.05) * 0.4;
                    const target = {
                        x: player.location.x + Math.sin(yaw) * FOLLOW_DIST + bobX + Math.cos(yaw) * orbit,
                        y: player.location.y + FOLLOW_HEIGHT + bobY,
                        z: player.location.z - Math.cos(yaw) * FOLLOW_DIST + bobZ + Math.sin(yaw) * orbit
                    };
                    try { spirit.teleport(target, { checkForBlocks: false }); } catch { }

                    const interval = pyroShootInterval(level);
                    if (now % interval === 0) {
                        firePyroProjectiles(spirit, player, level);
                    }
                }

                // ── FROST ──
                // Slow spiral hover 1.9 above target; smooth curved travel when switching targets
                else if (type === "frost") {
                    const range = frostTargetRange(level);
                    const monsters = dim.getEntities({
                        location: player.location,
                        maxDistance: range,
                        families: ["monster"]
                    });

                    const targetEnt = pickSpiritTarget(player, monsters, range);
                    const tLoc = targetEnt ? targetEnt.location : player.location;
                    const targetId = targetEnt?.id ?? "player";

                    // Ideal hover point (spiral + side offset)
                    const angle = (now + phase) * FROST_SPIRAL_SPEED;
                    const spiralX = Math.cos(angle) * FROST_SPIRAL_RADIUS;
                    const spiralZ = Math.sin(angle) * FROST_SPIRAL_RADIUS;

                    const toPlayerX = player.location.x - tLoc.x;
                    const toPlayerZ = player.location.z - tLoc.z;
                    const sideX = -toPlayerX;
                    const sideZ = -toPlayerZ;
                    const sideLen = Math.sqrt(sideX * sideX + sideZ * sideZ) || 1;
                    const offsetX = (sideX / sideLen) * FROST_SIDE_OFFSET;
                    const offsetZ = (sideZ / sideLen) * FROST_SIDE_OFFSET;

                    const ideal = {
                        x: tLoc.x + spiralX + offsetX,
                        y: tLoc.y + FROST_HOVER_HEIGHT,
                        z: tLoc.z + spiralZ + offsetZ
                    };

                    // Smooth non-straight travel
                    let state = frostHoverState.get(spirit.id);
                    if (!state) {
                        state = { x: spirit.location.x, y: spirit.location.y, z: spirit.location.z, targetId };
                        frostHoverState.set(spirit.id, state);
                    }

                    const switched = state.targetId !== targetId;
                    state.targetId = targetId;

                    // Max speed (blocks/tick). Lower = slower glide between targets.
                    const maxSpeed = switched ? FROST_SWITCH_SPEED : FROST_FOLLOW_SPEED;
                    const dx = ideal.x - state.x;
                    const dy = ideal.y - state.y;
                    const dz = ideal.z - state.z;
                    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

                    // Move toward ideal, but add a gentle perpendicular arc so path isn't a straight line
                    const step = Math.min(maxSpeed, dist);
                    const nx = dx / dist, nz = dz / dist;
                    // perpendicular wobble (stronger while travelling far)
                    const arc = switched || dist > 2 ? Math.sin(now * 0.07 + phase) * FROST_ARC_STRENGTH : 0;

                    state.x += nx * step + (-nz) * arc;
                    state.y += (dy / dist) * step;
                    state.z += nz * step + nx * arc;

                    const target = {
                        x: state.x + bobX * 0.6,
                        y: state.y + bobY * 0.5,
                        z: state.z + bobZ * 0.6
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
                        try {
                            dim.spawnParticle("subo:frost_zone", {
                                x: spirit.location.x, y: spirit.location.y, z: spirit.location.z
                            });
                            dim.playSound("subo.frost.zone", spirit.location, { volume: 0.6, pitch: 1.05 });
                        } catch { }
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
                const slowDur = frostSlownessDuration(zone.level);
                const fireDmg = frostFireDamage(zone.level);

                for (const e of ents) {
                    if (!e.isValid) continue;
                    const family = e.getComponent("minecraft:type_family");
                    if (!family?.hasTypeFamily?.("monster")) continue;
                    try {
                        e.addEffect("slowness", slowDur, { amplifier: amp, showParticles: true });
                    } catch { }

                    // extra damage to fire-related mobs when level > 5
                    if (fireDmg > 0 && (
                        e.typeId === "minecraft:magma_cube" ||
                        e.typeId === "minecraft:blaze" ||
                        e.typeId === "subo:fire_spark"
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

            const age = now - data.startTick;
            const t = Math.min(1, age / 12);
            const p0 = data.startPos, p1 = data.controlPos, p2 = target.location;
            const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
            const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
            const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * p1.z + t * t * p2.z;

            try { proj.teleport({ x, y, z }, { checkForBlocks: false }); } catch { }

            // Hit detection – slightly larger radius for reliability
            if (distSq({ x, y, z }, target.location) < 2.25) {   // ~1.5 blocks
                try {
                    // 1. Damage
                    target.applyDamage(data.damage, { cause: "magic" });

                    // 2. Slight knockback
                    const dx = target.location.x - data.startPos.x;
                    const dz = target.location.z - data.startPos.z;
                    const len = Math.sqrt(dx * dx + dz * dz) || 1;
                    target.applyImpulse({
                        x: (dx / len) * data.kbH,
                        y: data.kbV,
                        z: (dz / len) * data.kbH
                    });

                    // 3. Brief burn
                    target.setOnFire(data.burnSec, true);

                    // Player feedback
                    proj.dimension.spawnParticle("subo:pyro_hit", target.location);
                    try { proj.dimension.playSound("subo.pyro.hit", target.location, { volume: 0.7, pitch: 1.0 }); } catch { }

                } catch (err) {
                    console.warn("[Pyro] Hit failed:", err);
                }

                try { proj.remove(); } catch { }
                activeProjectiles.delete(proj);
                continue;
            }

            // Missed / finished arc → remove so nothing can stick
            if (age >= 20) {
                try { proj.remove(); } catch { }
                activeProjectiles.delete(proj);
            }
        }
    }, 1);
}

// ────────────────────────────────────────────────
//  Pyro multi-target shooting
// ────────────────────────────────────────────────
function firePyroProjectiles(spirit, player, level) {
    const dim = spirit.dimension;
    const count = pyroTargetCount(level);
    const dmg = pyroDamage(level);
    const kbH = pyroKnockbackHorizontal(level);
    const kbV = pyroKnockbackVertical(level);
    const burnSec = pyroBurnSeconds(level);

    const range = pyroTargetRange(level);

    const candidates = dim.getEntities({
        location: player.location,          // from player, not spirit
        maxDistance: range,
        families: ["monster"]
    });

    // Priority: anything < 1.5 blocks from player (no LOS).
    // Others need player LOS only.
    const valid = [];
    for (const m of candidates) {
        const dPlayer = distSq(m.location, player.location);
        const close = dPlayer <= CLOSE_PRIORITY_DIST_SQ;

        if (!close && !hasPlayerLOS(player, m)) continue;

        valid.push({ ent: m, dist: dPlayer, close });
    }
    // close threats first, then nearest
    valid.sort((a, b) => (b.close - a.close) || (a.dist - b.dist));

    if (valid.length === 0) return;

    try {
        spirit.playAnimation("animation.subo.pyro_spirit.shoot");
    } catch { }

    for (let i = 0; i < Math.min(count, valid.length); i++) {
        const target = valid[i].ent;
        let proj;
        try {
            proj = dim.spawnEntity(PYRO_PROJECTILE_ENTITY, spirit.location);
        } catch { continue; }

        proj.addTag(`damage:${dmg}`);
        try {
            dim.spawnParticle("subo:pyro_shoot", spirit.location);
            spirit.dimension.playSound("subo.pyro.shoot", spirit.location, { volume: 0.55, pitch: 1.1 });
        } catch { }

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
            damage: dmg,
            kbH,
            kbV,
            burnSec
        });
    }
}

/** True if the player has clear line-of-sight to the entity (eye → body). */
function hasPlayerLOS(player, entity) {
    const dim = player.dimension;
    const from = {
        x: player.location.x,
        y: player.location.y + 1.62,   // eye height
        z: player.location.z
    };
    const to = {
        x: entity.location.x,
        y: entity.location.y + 0.9,    // roughly chest/center
        z: entity.location.z
    };
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.15) return true;      // already overlapping

    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };

    try {
        const hit = dim.getBlockFromRay(from, dir, {
            maxDistance: dist - 0.2,          // stop just before the target body
            includePassableBlocks: false,
            includeLiquidBlocks: false
        });

        // Any solid hit before the target = blocked
        if (hit?.block) {
            // Prefer isSolid when available; fall back to !isAir
            const solid = typeof hit.block.isSolid === "boolean"
                ? hit.block.isSolid
                : !hit.block.isAir;
            if (solid) return false;
        }
    } catch {
        return false;
    }
    return true;
}

/**
 * Pick best monster for a spirit.
 * - Always prioritises anything < 1.5 blocks from the player (no LOS required).
 * - Otherwise requires player LOS.
 * Returns the entity or null.
 */
function pickSpiritTarget(player, candidates, maxDist = 24) {
    let bestClose = null, bestCloseD = Infinity;
    let bestFar = null, bestFarD = Infinity;

    for (const m of candidates) {
        if (!m.isValid) continue;
        const d = distSq(m.location, player.location);
        if (d > maxDist * maxDist) continue;

        if (d <= CLOSE_PRIORITY_DIST_SQ) {
            if (d < bestCloseD) { bestCloseD = d; bestClose = m; }
        } else if (hasPlayerLOS(player, m)) {
            if (d < bestFarD) { bestFarD = d; bestFar = m; }
        }
    }
    return bestClose ?? bestFar;
}

function distSq(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

// ────────────────────────────────────────────────
//  Recovery
// ────────────────────────────────────────────────
export function recoverSpirits() {
    // Clear any projectiles left from a previous session / crash
    cleanupOrphanProjectiles();

    for (const p of world.getPlayers()) {
        if (p.dimension.id === RIFT_DIMENSION_ID) {
            loadPlayerLevels(p);
            spawnSpiritsForPlayer(p);
            // const newLevel = addSpiritLevel(p, "pyro", -60);
        }
    }
}