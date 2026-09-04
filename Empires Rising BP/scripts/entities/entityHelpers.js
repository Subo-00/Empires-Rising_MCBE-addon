import { system, world } from "@minecraft/server";

/** Squared 3-D distance (cheap comparison). */
export function distSq3D(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

/** Full 3-D distance. */
export function distanceBetween(loc1, loc2) {
    return Math.sqrt(distSq3D(loc1, loc2));
}

export function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * Generic LOS check (eye → body).
 * @param {import("@minecraft/server").Entity} fromEntity
 * @param {import("@minecraft/server").Entity} toEntity
 * @param {{ fromHeight?: number, toHeight?: number }} [opts]
 */
export function hasLineOfSight(fromEntity, toEntity, opts = {}) {
    if (!fromEntity?.isValid || !toEntity?.isValid) return false;

    const fromH = opts.fromHeight ?? 1.7;
    const toH   = opts.toHeight   ?? 1.0;

    const from = {
        x: fromEntity.location.x,
        y: fromEntity.location.y + fromH,
        z: fromEntity.location.z
    };
    const to = {
        x: toEntity.location.x,
        y: toEntity.location.y + toH,
        z: toEntity.location.z
    };

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance < 0.5) return true;

    const direction = { x: dx / distance, y: dy / distance, z: dz / distance };
    const manhattan = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);

    try {
        const hit = fromEntity.dimension.getBlockFromRay(from, direction, {
            maxDistance: Math.max(manhattan, distance) + 0.5,
            includeLiquidBlocks: false,
            includePassableBlocks: false
        });
        return hit === undefined;
    } catch {
        return false;
    }
}

/**
 * Simple “is this a combat-valid player / troop?” check
 * (used by darkKnight, lavaGolem, fireSpirit – no faction logic).
 */
export function isSimpleValidTarget(entity) {
    if (!entity?.isValid) return false;

    if (entity.typeId === "minecraft:player") {
        const mode = entity.getGameMode();
        return mode !== "Creative" && mode !== "Spectator" &&
               mode !== "creative" && mode !== "spectator";
    }

    const family = entity.getComponent("minecraft:type_family");
    return family?.hasTypeFamily("subo_troop") ?? false;
}

/** All entities that pass `isValid` within range. */
export function getNearbyTargets(source, maxDistance, isValid) {
    return source.dimension.getEntities({
        location: source.location,
        maxDistance
    }).filter(e => e.id !== source.id && isValid(e));
}

/** Nearest entity that passes `isValid` (optional LOS). */
export function getNearestTarget(source, maxDistance, isValid, requireLos = false) {
    const candidates = source.dimension.getEntities({
        location: source.location,
        maxDistance
    });

    let nearest = null;
    let bestDistSq = Infinity;

    for (const e of candidates) {
        if (e.id === source.id || !isValid(e)) continue;
        const dSq = distSq3D(source.location, e.location);
        if (dSq >= bestDistSq) continue;
        if (requireLos && !hasLineOfSight(source, e)) continue;
        bestDistSq = dSq;
        nearest = e;
    }
    return nearest;
}