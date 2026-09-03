import { system, world } from "@minecraft/server";

const basicCooldown = new Map();
const spinCooldown = new Map();
const leapCooldown = new Map();
const healCooldown = new Map();
const blinkCooldown = new Map();

const BASIC_COOLDOWN_TICKS = 20;
const SPIN_COOLDOWN_TICKS = 50;
const LEAP_COOLDOWN_TICKS = 80;
const HEAL_COOLDOWN_TICKS = 180;
const BLINK_COOLDOWN_TICKS = 300;

const BASIC_RANGE = 2.3;
const SPIN_RANGE = 2.3;
const LEAP_MAX_RANGE = 10;
const DETECTION_RANGE = 45;

const BASIC_DAMAGE = 10;
const SPIN_DAMAGE = 10;

const hasTaunted = new Set();
const knightTargets = new Map();   // knightId → { entity, tick }
const activeHealers = new Map();   // knightId → intervalId
const useBasic2Map = new Map();   // knightId → boolean (was a global before)

const LAST_HIT_TIMEOUT = 80; // ~4 seconds – how long the last attacker stays priority

// ────────────────────────────────────────────────
// Events
// ────────────────────────────────────────────────
world.afterEvents.entityHitEntity.subscribe((event) => {
    if (event.hitEntity.typeId === "subo:dark_knight") {
        knightTargets.set(event.hitEntity.id, {
            entity: event.damagingEntity,
            tick: system.currentTick
        });
    }
});

world.afterEvents.entityDie.subscribe((event) => {
    if (event.deadEntity.typeId === "subo:dark_knight") {
        const id = event.deadEntity.id;
        stopHealingParticles(id);

        hasTaunted.delete(id);
        basicCooldown.delete(id);
        spinCooldown.delete(id);
        leapCooldown.delete(id);
        healCooldown.delete(id);
        blinkCooldown.delete(id);
        knightTargets.delete(id);
        useBasic2Map.delete(id);
    }
});

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────
function isValidTarget(entity) {
    if (!entity?.isValid) return false;

    if (entity.typeId === "minecraft:player") {
        const mode = entity.getGameMode();
        return mode !== "Creative" && mode !== "Spectator";
    }

    const family = entity.getComponent("minecraft:type_family");
    return family?.hasTypeFamily("subo_troop") ?? false;
}

function getNearbyTargets(knight, maxDistance, requireLos = false) {
    return knight.dimension.getEntities({
        location: knight.location,
        maxDistance: maxDistance
    }).filter(e => {
        if (e.id === knight.id || !isValidTarget(e)) return false;
        if (requireLos && !hasLineOfSight(knight, e)) return false;
        return true;
    });
}

// Only check LOS when actually selecting a target
function getNearestTarget(knight, maxDistance) {
    // Prefer last attacker (with LOS check)
    const entry = knightTargets.get(knight.id);
    if (entry?.entity?.isValid &&
        (system.currentTick - entry.tick) < LAST_HIT_TIMEOUT &&
        hasLineOfSight(knight, entry.entity)) {
        return entry.entity;
    }

    const targets = getNearbyTargets(knight, maxDistance); // no LOS here yet
    if (targets.length === 0) return null;

    // Sort by distance first, then check LOS only on the closest few
    targets.sort((a, b) => {
        const da = distanceBetween(a.location, knight.location);
        const db = distanceBetween(b.location, knight.location);
        return da - db;
    });

    // Check the 3 closest candidates only
    for (let i = 0; i < Math.min(3, targets.length); i++) {
        if (hasLineOfSight(knight, targets[i])) {
            return targets[i];
        }
    }

    return null;
}

/**
 * Returns true if there is a clear line of sight between two entities.
 * Uses a raycast from the knight’s approximate eye height to the target’s body.
 */
function hasLineOfSight(fromEntity, toEntity) {
    if (!fromEntity?.isValid || !toEntity?.isValid) return false;

    // Approximate eye / head height of the Dark Knight (adjust if your model is taller/shorter)
    const from = {
        x: fromEntity.location.x,
        y: fromEntity.location.y + 1.7,
        z: fromEntity.location.z
    };

    // Aim roughly at the target’s chest / center
    const to = {
        x: toEntity.location.x,
        y: toEntity.location.y + 1.0,
        z: toEntity.location.z
    };

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance < 0.5) return true; // extremely close → always allow

    const direction = {
        x: dx / distance,
        y: dy / distance,
        z: dz / distance
    };

    // getBlockFromRay uses Manhattan distance for maxDistance → give it a safe buffer
    const manhattan = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);

    try {
        const hit = fromEntity.dimension.getBlockFromRay(from, direction, {
            maxDistance: Math.max(manhattan, distance) + 0.5, // enough to reach the target
            includeLiquidBlocks: false,
            includePassableBlocks: false   // ignore vines, flowers, etc.
        });

        // No solid block was hit → clear line of sight
        return hit === undefined;
    } catch {
        return false;
    }
}

function distanceBetween(loc1, loc2) {
    const dx = loc1.x - loc2.x;
    const dy = loc1.y - loc2.y;
    const dz = loc1.z - loc2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function resetAttackState(knight, ticks) {
    system.runTimeout(() => {
        if (knight?.isValid) {
            try {
                knight.setProperty("subo:attack_state", 0);
            } catch { }
        }
    }, ticks);
}

function startHealingParticles(knight) {
    if (!knight?.isValid) return;

    const knightId = knight.id;

    if (activeHealers.has(knightId)) {
        system.clearRun(activeHealers.get(knightId));
    }

    const intervalId = system.runInterval(() => {
        if (!knight?.isValid) {
            stopHealingParticles(knightId);
            return;
        }

        const loc = knight.location;
        const offsetX = (Math.random() - 0.5) * 0.5;
        const offsetY = Math.random() * 1.4;
        const offsetZ = (Math.random() - 0.5) * 0.5;

        try {
            knight.dimension.spawnParticle("minecraft:crop_growth_emitter", {
                x: loc.x + offsetX,
                y: loc.y + offsetY,
                z: loc.z + offsetZ
            });
        } catch { }
    }, 10);

    activeHealers.set(knightId, intervalId);

    system.runTimeout(() => {
        stopHealingParticles(knightId);
    }, 40);
}

function stopHealingParticles(knightId) {
    if (activeHealers.has(knightId)) {
        system.clearRun(activeHealers.get(knightId));
        activeHealers.delete(knightId);
    }
}

function spawnEnderPearlParticles(dimension, loc) {
    for (let i = 0; i < 10; i++) {
        const offsetX = (Math.random() - 0.5) * 1.2;
        const offsetY = Math.random() * 1.8;
        const offsetZ = (Math.random() - 0.5) * 1.2;
        try {
            dimension.spawnParticle("minecraft:mob_portal", {
                x: loc.x + offsetX,
                y: loc.y + offsetY,
                z: loc.z + offsetZ
            });
        } catch { }
    }
}

// ────────────────────────────────────────────────
// MAIN TICK
// ────────────────────────────────────────────────
export function darkKnightTick() {
    const currentTick = system.currentTick;

    for (const player of world.getAllPlayers()) {
        const nearbyKnights = player.dimension.getEntities({
            type: "subo:dark_knight",
            location: player.location,
            maxDistance: 80
        });

        for (const knight of nearbyKnights) {
            if (!knight?.isValid) continue;

            const attackState = knight.getProperty("subo:attack_state") ?? 0;
            if (attackState !== 0) continue; // still busy with an attack

            const target = getNearestTarget(knight, DETECTION_RANGE);
            if (!target) continue;

            const knightId = knight.id;
            const dist = distanceBetween(knight.location, target.location);

            // Taunt on first sight of a player
            if (!hasTaunted.has(knightId) && target.typeId === "minecraft:player") {
                hasTaunted.add(knightId);
                knight.triggerEvent("dark_knight:start_taunt");
                continue;
            }

            const nextBasic = basicCooldown.get(knightId) ?? 0;
            const nextSpin = spinCooldown.get(knightId) ?? 0;
            const nextLeap = leapCooldown.get(knightId) ?? 0;
            const nextHeal = healCooldown.get(knightId) ?? 0;
            const nextBlink = blinkCooldown.get(knightId) ?? 0;

            const healthComp = knight.getComponent("minecraft:health");

            const healthPercent = healthComp
                ? healthComp.currentValue / healthComp.effectiveMax
                : 1;

            const isFullHealth = healthComp
                ? healthComp.currentValue >= healthComp.effectiveMax
                : true;

            // === SPIN ATTACK ===
            if (dist <= SPIN_RANGE && currentTick >= nextSpin) {
                knight.triggerEvent("dark_knight:start_spin");
                spinCooldown.set(knightId, currentTick + SPIN_COOLDOWN_TICKS);
                resetAttackState(knight, 12);

                const nearby = getNearbyTargets(knight, SPIN_RANGE);
                const entry = knightTargets.get(knightId);
                const spinTargets = [...nearby];

                if (entry?.entity?.isValid &&
                    !spinTargets.some(e => e.id === entry.entity.id) &&
                    distanceBetween(entry.entity.location, knight.location) <= SPIN_RANGE) {
                    spinTargets.push(entry.entity);
                }

                for (const t of spinTargets) {
                    try {
                        t.applyDamage(SPIN_DAMAGE, { cause: "entityAttack", damagingEntity: knight });

                        const dx = t.location.x - knight.location.x;
                        const dz = t.location.z - knight.location.z;
                        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
                        t.applyKnockback(dx / len, dz / len, 1.4, 0.3);
                    } catch { }
                }
                continue;
            }

            // === BASIC ATTACK ===
            if (dist <= BASIC_RANGE && currentTick >= nextBasic) {
                knight.triggerEvent("dark_knight:start_basic");

                // Per-knight basic animation toggle
                const useBasic2 = useBasic2Map.get(knightId) ?? false;
                if (useBasic2) {
                    knight.triggerEvent("dark_knight:use_basic2");
                    useBasic2Map.set(knightId, false);
                } else {
                    knight.triggerEvent("dark_knight:use_basic1");
                    useBasic2Map.set(knightId, true);
                }

                basicCooldown.set(knightId, currentTick + BASIC_COOLDOWN_TICKS);
                resetAttackState(knight, 15);

                const nearby = getNearbyTargets(knight, BASIC_RANGE + 2);
                const entry = knightTargets.get(knightId);
                let basicTargets = [...nearby];

                if (entry?.entity?.isValid &&
                    !basicTargets.some(e => e.id === entry.entity.id) &&
                    distanceBetween(entry.entity.location, knight.location) <= BASIC_RANGE + 3) {
                    basicTargets.push(entry.entity);
                }

                const slashTargets = basicTargets
                    .sort((a, b) =>
                        distanceBetween(a.location, knight.location) -
                        distanceBetween(b.location, knight.location)
                    )
                    .slice(0, 2);

                for (const t of slashTargets) {
                    try {
                        t.applyDamage(BASIC_DAMAGE, {
                            cause: "entityAttack",
                            damagingEntity: knight
                        });

                        const dx = t.location.x - knight.location.x;
                        const dz = t.location.z - knight.location.z;
                        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
                        t.applyKnockback(dx / len, dz / len, 1.2, 0.25);
                    } catch { }
                }
                continue;
            }

            // === FAST DASH / LEAP ===
            if (dist > 5 && dist <= LEAP_MAX_RANGE && currentTick >= nextLeap) {
                knight.triggerEvent("dark_knight:start_leap");
                leapCooldown.set(knightId, currentTick + LEAP_COOLDOWN_TICKS);
                resetAttackState(knight, 15);

                if (!knight?.isValid || !target?.isValid) continue;

                const dx = target.location.x - knight.location.x;
                const dz = target.location.z - knight.location.z;
                let yaw = Math.atan2(dx, dz) * (180 / Math.PI);
                knight.setRotation({ x: 0, y: yaw });

                system.runTimeout(() => {
                    if (!knight?.isValid || !target?.isValid) return;

                    const dx2 = target.location.x - knight.location.x;
                    const dz2 = target.location.z - knight.location.z;
                    const dy = target.location.y - knight.location.y + 0.4;
                    const d = Math.sqrt(dx2 * dx2 + dy * dy + dz2 * dz2);

                    if (d < 2) return;

                    const power = 3.6;
                    knight.applyImpulse({
                        x: (dx2 / d) * power,
                        y: (dy / d) * 0.25,
                        z: (dz2 / d) * power
                    });

                    system.runTimeout(() => {
                        if (knight?.isValid) knight.clearVelocity();
                    }, Math.min(Math.floor(dist), 20));
                }, 2);

                continue;
            }

            // === BLINK / TELEPORT ===
            if (dist >= 8 && dist <= 25 && currentTick >= nextBlink) {
                if (!hasLineOfSight(knight, target)) continue;
                const BLINK_TELEPORT_TICK = 30; // 75 % of the 2-second heal anim

                knight.triggerEvent("dark_knight:start_blink");
                blinkCooldown.set(knightId, currentTick + BLINK_COOLDOWN_TICKS);
                resetAttackState(knight, 40);

                const originLoc = { ...knight.location };
                spawnEnderPearlParticles(knight.dimension, originLoc);

                system.runTimeout(() => {
                    if (!knight?.isValid || !target?.isValid) return;

                    const dx = target.location.x - knight.location.x;
                    const dz = target.location.z - knight.location.z;
                    const distToTarget = Math.sqrt(dx * dx + dz * dz);

                    if (distToTarget < 3) return;

                    const teleportDist = 0.5;
                    const tx = target.location.x - (dx / distToTarget) * teleportDist;
                    const tz = target.location.z - (dz / distToTarget) * teleportDist;
                    const ty = target.location.y + 0.1;
                    const destLoc = { x: tx, y: ty, z: tz };

                    spawnEnderPearlParticles(knight.dimension, originLoc);
                    knight.teleport(destLoc, { checkForBlocks: false });
                    spawnEnderPearlParticles(knight.dimension, destLoc);
                }, BLINK_TELEPORT_TICK);

                continue;
            }

            // === HEAL (only as last resort) ===
            // Conditions:
            // - Not at full health
            // - Heal cooldown ready
            // - No other attack was possible this tick (we reached here)
            if (!isFullHealth && currentTick >= nextHeal) {
                knight.triggerEvent("dark_knight:start_heal");
                healCooldown.set(knightId, currentTick + HEAL_COOLDOWN_TICKS);

                if (healthComp) {
                    // Heal to full max health
                    healthComp.setCurrentValue(healthComp.effectiveMax);
                }

                startHealingParticles(knight);
                resetAttackState(knight, 40); // 2 seconds
                continue;
            }
        }
    }
}