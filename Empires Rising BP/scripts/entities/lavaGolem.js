import { system, world } from "@minecraft/server";
import {
    SPIN_COOLDOWN_TICKS, SPIT_COOLDOWN_TICKS, SLAM_COOLDOWN_TICKS,
    SLAM_RANGE, SPIN_RANGE, SPIT_RANGE, DETECTION_RANGE,
    SLAM_DMG, SPIN_DMG
} from "../config/entities/lavaGolemConfig.js";
import {
    isSimpleValidTarget, getNearbyTargets, distSq3D
} from "./entityHelpers.js";

const spinCooldown = new Map();
const spitCooldown = new Map();
const slamCooldown = new Map();

// Track which golem already taunted 
const hasTaunted = new Set();

// Track targets that hurt it
const golemTargets = new Map();

world.afterEvents.entityHitEntity.subscribe((event) => {
    if (event.hitEntity.typeId === "subo:lava_golem") {
        // Record the last thing the golem actually hit
        golemTargets.set(event.hitEntity.id, event.damagingEntity);
    }
});

// Clean up golem data
world.afterEvents.entityDie.subscribe((event) => {
    if (event.deadEntity.typeId === "subo:lava_golem") {
        const id = event.deadEntity.id;
        hasTaunted.delete(id);
        spinCooldown.delete(id);
        spitCooldown.delete(id);
        slamCooldown.delete(id);
        golemTargets.delete(id);
    }
});

function getPriorityTarget(golem, maxDistance) {
    const lastHit = golemTargets.get(golem.id);
    if (lastHit?.isValid) return lastHit;

    const targets = getNearbyTargets(golem, maxDistance, isSimpleValidTarget);
    if (targets.length === 0) return null;

    let nearest = null;
    let bestDistSq = Infinity;
    for (const t of targets) {
        const dSq = distSq3D(golem.location, t.location);
        if (dSq < bestDistSq) {
            bestDistSq = dSq;
            nearest = t;
        }
    }
    return nearest;
}

// Called from main.js every 5 ticks
export function lavaGolemTick() {
    const currentTick = system.currentTick;
    const overworld = world.getDimension("overworld");

    for (const player of world.getAllPlayers()) {
        const nearbyGolems = overworld.getEntities({
            type: "subo:lava_golem",
            location: player.location,
            maxDistance: 80
        });

        for (const golem of nearbyGolems) {
            if (!golem?.isValid) continue;

            const attackState = golem.getProperty("subo:attack_state");
            if (attackState !== 0) {
                if (attackState === 2) {
                    const nearby = getNearbyTargets(golem, SPIN_RANGE, isSimpleValidTarget);

                    // Include golemTargets entity even if outside getNearbyTargets filter
                    const lastHit = golemTargets.get(golem.id);
                    const spinTargets = [...nearby];
                    if (lastHit?.isValid && !spinTargets.some(e => e.id === lastHit.id)) {
                        if (distSq3D(lastHit.location, golem.location) <= SPIN_RANGE * SPIN_RANGE) {
                            spinTargets.push(lastHit);
                        }
                    }

                    for (const target of spinTargets) {
                        try {
                            target.applyDamage(SPIN_DMG, {
                                cause: "entityAttack",
                                damagingEntity: golem
                            });

                            const dx = target.location.x - golem.location.x;
                            const dz = target.location.z - golem.location.z;
                            const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));

                            target.applyKnockback(dx / len, dz / len, 1.4, 0.25);
                        } catch { }
                    }
                }

                continue;
            }

            const target = getPriorityTarget(golem, DETECTION_RANGE);
            if (!target) continue;

            const golemId = golem.id;

            // Taunt
            if (!hasTaunted.has(golemId) && target.typeId === "minecraft:player") {
                hasTaunted.add(golemId);
                golem.triggerEvent("lava_golem:start_taunt");
                continue; // skip attacking this tick
            }

            const dx = target.location.x - golem.location.x;
            const dy = target.location.y - golem.location.y;
            const dz = target.location.z - golem.location.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            const nextSpin = spinCooldown.get(golemId) ?? 0;
            const nextSpit = spitCooldown.get(golemId) ?? 0;
            const nextSlam = slamCooldown.get(golemId) ?? 0;

            if (dist <= SPIN_RANGE && currentTick >= nextSpin) {
                golem.triggerEvent("lava_golem:start_spin");
                spinCooldown.set(golemId, currentTick + SPIN_COOLDOWN_TICKS);
                continue;
            }

            if (dist <= SLAM_RANGE && currentTick >= nextSlam) {
                const nearby = getNearbyTargets(golem, SLAM_RANGE, isSimpleValidTarget);

                const lastHit = golemTargets.get(golemId);
                if (lastHit?.isValid && !nearby.some(e => e.id === lastHit.id)) {
                    if (distSq3D(lastHit.location, golem.location) <= SLAM_RANGE * SLAM_RANGE) {
                        nearby.push(lastHit);
                    }
                }

                // Damage 3 nearest targets
                const slamTargets = nearby
                    .sort((a, b) => {
                        const distSq = (e) => {
                            const dx = e.location.x - golem.location.x;
                            const dy = e.location.y - golem.location.y;
                            const dz = e.location.z - golem.location.z;
                            return dx * dx + dy * dy + dz * dz;
                        };
                        return distSq(a) - distSq(b);
                    })
                    .slice(0, 3);

                for (const t of slamTargets) {
                    try {
                        t.applyDamage(SLAM_DMG, { cause: "entityAttack", damagingEntity: golem });
                    } catch { }
                }

                golem.triggerEvent("lava_golem:on_slam");
                slamCooldown.set(golemId, currentTick + SLAM_COOLDOWN_TICKS);
                continue;
            }

            if (dist <= SPIT_RANGE && currentTick >= nextSpit) {
                golem.triggerEvent("lava_golem:start_spit");
                spitCooldown.set(golemId, currentTick + SPIT_COOLDOWN_TICKS);

                // Spawn 3 fire spirits one by one, staggered ~5 ticks apart
                const spawnDelays = [10, 15, 20]; // ticks after spit starts
                for (const delay of spawnDelays) {
                    system.runTimeout(() => {
                        if (!golem?.isValid) return;

                        // Spawn at the golem's head position (slightly forward and up)
                        const loc = golem.location;
                        const yaw = golem.getRotation().y * (Math.PI / 180);

                        // Offset forward from the golem's facing direction
                        const spawnPos = {
                            x: loc.x - Math.sin(yaw) * 0.4,
                            y: loc.y + 2.8, // head height
                            z: loc.z + Math.cos(yaw) * 0.4
                        };

                        try {
                            const spirit = golem.dimension.spawnEntity("subo:fire_spirit", spawnPos);

                            // Give it a small outward impulse so they pop out visually
                            const spread = (Math.random() - 0.5) * 0.4;
                            spirit.applyImpulse({
                                x: -Math.sin(yaw) * 0.3 + spread,
                                y: 0.4,
                                z: Math.cos(yaw) * 0.3 + spread
                            });
                        } catch { }
                    }, delay);
                }

                continue;
            }
        }
    }
}