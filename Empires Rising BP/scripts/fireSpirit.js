import { system, world } from "@minecraft/server";

const LEAP_RANGE = 3.0;           // Slightly increased for reliability
const DETECTION_RANGE = 24;
const leapedSpirits = new Map();  // Now stores {targetId, launchTime}

function isValidTarget(entity) {
    if (!entity?.isValid) return false;
    if (entity.typeId === "minecraft:player") {
        const mode = entity.getGameMode();
        return mode !== "creative" && mode !== "spectator";
    }
    const family = entity.getComponent("minecraft:type_family");
    return family?.hasTypeFamily("subo_troop") ?? false;
}

function getNearestTarget(spirit) {
    const entities = spirit.dimension.getEntities({
        location: spirit.location,
        maxDistance: DETECTION_RANGE,
        excludeTypes: ["minecraft:item"]
    });

    let nearest = null;
    let bestDistSq = Infinity;

    for (const e of entities) {
        if (e.id === spirit.id || !isValidTarget(e)) continue;

        const dx = e.location.x - spirit.location.x;
        const dy = e.location.y - spirit.location.y;
        const dz = e.location.z - spirit.location.z;
        const distSq = dx*dx + dy*dy + dz*dz;

        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            nearest = e;
        }
    }
    return nearest;
}

world.afterEvents.entityDie.subscribe((event) => {
    if (event.deadEntity.typeId === "subo:fire_spirit") {
        leapedSpirits.delete(event.deadEntity.id);
    }
});

// Called every 5 ticks
export function fireSpiritTick() {
    const overworld = world.getDimension("overworld");

    for (const player of world.getAllPlayers()) {
        const spirits = overworld.getEntities({
            type: "subo:fire_spirit",
            location: player.location,
            maxDistance: 80
        });

        for (const spirit of spirits) {
            if (!spirit.isValid) continue;

            const spiritLoc = spirit.location;
            const isLeaping = spirit.getProperty("subo:is_leaping");

            // === EMIT SMOKE ===
            if (Math.random() < 0.25) {
                try {
                    spirit.dimension.spawnParticle("minecraft:basic_smoke_particle", {
                        x: spiritLoc.x,
                        y: spiritLoc.y + 0.5,
                        z: spiritLoc.z
                    });
                } catch {}
            }

            // === HANDLE LEAPING SPIRITS (collision + stop) ===
            if (isLeaping) {
                const data = leapedSpirits.get(spirit.id);
                if (!data) continue;

                const target = data.targetId ? world.getEntity(data.targetId) : null;

                if (target?.isValid) {
                    const dx = target.location.x - spiritLoc.x;
                    const dy = target.location.y - spiritLoc.y;
                    const dz = target.location.z - spiritLoc.z;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

                    // Hit detected
                    if (dist < 1.8) {   // Adjust based on your collision box
                        triggerExplosion(spirit, target);
                        continue;
                    }
                }

                // Safety timeout (max 2 seconds in air)
                if (Date.now() - data.launchTime > 2000) {
                    triggerExplosion(spirit);
                }
                continue;
            }

            // === NORMAL BEHAVIOR (find target + leap) ===
            if (leapedSpirits.has(spirit.id)) continue;

            const target = getNearestTarget(spirit);
            if (!target) continue;

            const dx = target.location.x - spiritLoc.x;
            const dy = target.location.y - spiritLoc.y;
            const dz = target.location.z - spiritLoc.z;
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (dist <= LEAP_RANGE) {
                leapedSpirits.set(spirit.id, {
                    targetId: target.id,
                    launchTime: Date.now()
                });

                spirit.triggerEvent("fire_spirit:start_leap");

                // Stronger, more directed leap
                const len = Math.max(0.001, dist);
                spirit.applyImpulse({
                    x: (dx / len) * 1.1,
                    y: 0.25,
                    z: (dz / len) * 1.1
                });
            }
        }
    }
}

function triggerExplosion(spirit, target = null) {
    if (!spirit?.isValid) return;

    const loc = spirit.location;

    // Stop all momentum
    try {
        spirit.setVelocity({ x: 0, y: 0, z: 0 });
    } catch {}

    // Visual explosion
    try {
        spirit.dimension.spawnParticle("minecraft:explosion_emitter", loc);
        spirit.dimension.spawnParticle("minecraft:large_explosion", {
            x: loc.x, y: loc.y + 0.3, z: loc.z
        });
    } catch {}

    // Damage target if we actually hit
    if (target?.isValid) {
        try {
            target.applyDamage(7, {
                cause: "entityExplosion",
                damagingEntity: spirit
            });
            target.setOnFire(3, true);
        } catch {}
    }

    // Trigger despawn
    spirit.triggerEvent("fire_spirit:explode");
    leapedSpirits.delete(spirit.id);
}