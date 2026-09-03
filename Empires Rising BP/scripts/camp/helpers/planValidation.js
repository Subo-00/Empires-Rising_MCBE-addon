import {
    MIN_VALID_RATIO,
    MAX_STRUCTURE_Y_DELTA,
    WALL_LAYER_SPACING,
    WALL_LAYER_COUNT,
    TERRAIN_SCAN_UP, TERRAIN_SCAN_DOWN,
} from "../../config/camp/configCamp.js";
import {
    clampY,
    key2,
    structureCornersHaveSupport,
} from "./smallHelpers.js";
import { isLiquidType, getBlockSafe, shouldIgnoreForTerrainTop } from "./blockHelpers.js";
import { CAMP_SHAPES } from "../../config/camp/styleSystem.js";
import { generateWallPoints, generateRectangleWall } from "./geometry.js";
import { generateStructureSpots } from "./structureSpots.js";

/**
 * Returns how many wall rings this camp size should have.
 */
export function getWallLayerCount(sizeKey) {
    return WALL_LAYER_COUNT[sizeKey] ?? 1;
}

/**
 * Generates all wall-ring point arrays for a plan.
 * Ring 0 is the outermost wall (at sizeDef.diameter).
 * Each subsequent ring is WALL_LAYER_SPACING blocks closer to the center.
 * Points that already appear in an outer ring are stripped from inner rings
 * so pillars never stack on the same XZ position.
 */
export function generateAllWallLayers(shapeKey, cx, cz, sizeDef) {
    const layerCount = getWallLayerCount(sizeDef.key);
    const layers = [];
    const usedPositions = new Set();

    for (let i = 0; i < layerCount; i++) {
        // Ring 0 = outermost (original diameter), ring 1 = one step inward, etc.
        const ringDiameter = sizeDef.diameter - i * WALL_LAYER_SPACING * 2;
        if (ringDiameter < 5) break; // sanity guard

        const rawPoints = shapeKey === "rectangle"
            ? generateRectangleWall(cx, cz, sizeDef.diameter, i)
            : generateWallPoints(shapeKey, cx, cz, ringDiameter);

        // Filter out any XZ position already occupied by an outer ring
        const filteredPoints = rawPoints.filter(p => {
            const k = key2(p.x, p.z);
            return !usedPositions.has(k);
        });

        // Register all positions of this ring so inner rings avoid them
        for (const p of filteredPoints) {
            usedPositions.add(key2(p.x, p.z));
        }

        layers.push(filteredPoints);
    }

    return layers;
}

export function createPlan(cx, cy, cz, sizeDef, shapeDef, activePools) {
    // Shared layout index is no longer needed (we generate spots procedurally)
    const wallLayers = generateAllWallLayers(shapeDef.key, cx, cz, sizeDef);
    const wallPoints = wallLayers[0] ?? [];

    const plan = {
        center: { x: cx, y: cy, z: cz },
        size: sizeDef,
        shape: shapeDef,
        wallPoints,
        wallLayers,          // multi-ring walls
        structureSpots: [],
        validStructureSpots: [],
        invalidStructureSpots: [],
        weight: 0,
    };

    // Generate the randomized structure list now that we have the plan object
    // (needed for interior bounds + collision checks)
    plan.structureSpots = generateStructureSpots(plan, activePools);

    return plan;
}

export async function validatePlan(plan, dimension, cache) {
    let requiredFailed = false;

    for (const spot of plan.structureSpots) {
        const top = getGroundY(dimension, spot.x, spot.z, plan.center.y, cache);

        if (!top.ok) {
            plan.invalidStructureSpots.push({ ...spot, suitable: false, reason: top.reason });
            if (spot.required) requiredFailed = true;
            continue;
        }

        // NEW: liquid surface → invalid, but recoverable after platform placement
        if (isLiquidType(top.typeId)) {
            plan.invalidStructureSpots.push({
                ...spot,
                suitable: false,
                y: top.y,
                blockTypeId: top.typeId,
                reason: "liquid",
            });
            if (spot.required) requiredFailed = true;
            continue;
        }

        const delta = Math.abs(top.y - plan.center.y);

        if (delta > MAX_STRUCTURE_Y_DELTA) {
            plan.invalidStructureSpots.push({
                ...spot,
                suitable: false,
                y: top.y,
                blockTypeId: top.typeId,
                reason: `y_delta_${delta}`,
            });
            if (spot.required) requiredFailed = true;
            continue;
        }

        const baseY = top.y + 1;
        const cornerSupport = structureCornersHaveSupport(
            dimension,
            spot.x,
            baseY,
            spot.z,
            spot.fw,
            spot.fd
        );

        if (!cornerSupport.ok) {
            plan.invalidStructureSpots.push({
                ...spot,
                suitable: false,
                y: top.y,
                blockTypeId: top.typeId,
                reason: cornerSupport.reason,
                badCornerX: cornerSupport.x,
                badCornerZ: cornerSupport.z,
            });
            if (spot.required) requiredFailed = true;
            continue;
        }

        plan.validStructureSpots.push({
            ...spot,
            suitable: true,
            y: top.y,
            blockTypeId: top.typeId,
        });
    }

    if (requiredFailed) return false;
    if (plan.validStructureSpots.length === 0) return false;

    const usableRatio = plan.validStructureSpots.length / Math.max(1, plan.structureSpots.length);
    const minRatio = MIN_VALID_RATIO[plan.size.key] ?? 0.9;

    // Reject if terrain is too poor for this camp size
    if (usableRatio < minRatio) return false;

    // Weight: size preference * shape preference * terrain quality
    // Poor terrain still reduces weight, but only valid plans get here
    plan.weight = plan.size.weight * plan.shape.weight * (0.5 + usableRatio * 1.35);

    return true;
}

export function weightedRandom(plans) {
    const total = plans.reduce((sum, p) => sum + Math.max(0, p.weight), 0);

    if (total <= 0) {
        return plans[Math.floor(Math.random() * plans.length)];
    }

    let roll = Math.random() * total;

    for (const plan of plans) {
        roll -= plan.weight;
        if (roll <= 0) return plan;
    }

    return plans[plans.length - 1];
}

export async function chooseCampPlan(dimension, cx, cy, cz, candidateSizes, cache, activePools) {

    for (const sizeDef of candidateSizes) {
        const validPlans = [];

        for (const shapeDef of CAMP_SHAPES) {
            const plan = createPlan(cx, cy, cz, sizeDef, shapeDef, activePools);
            const ok = await validatePlan(plan, dimension, cache);
            if (ok) validPlans.push(plan);
        }

        if (validPlans.length > 0) {
            const plan = weightedRandom(validPlans);
            console.warn(
                `[camp] PLAN picked size=${plan.size.key} shape=${plan.shape.key} ` +
                `validShapes=${validPlans.length} weight=${plan.weight.toFixed(2)}`
            );
            return { ok: true, plan };
        }
    }

    return { ok: false, reason: "no_valid_camp_plan" };
}

export function getGroundY(dimension, x, z, centerY, cache = null) {
    let k;
    if (cache) {
        k = key2(x, z);
        const hit = cache.get(k);
        if (hit !== undefined) return hit;
    }
    const maxY = clampY(centerY + TERRAIN_SCAN_UP);
    const minY = clampY(centerY - TERRAIN_SCAN_DOWN);
    for (let y = maxY; y >= minY; y--) {
        const block = getBlockSafe(dimension, x, y, z);
        if (!shouldIgnoreForTerrainTop(block)) {
            const res = { ok: true, y, typeId: block?.typeId ?? "minecraft:air" };
            if (cache) cache.set(k, res);
            return res;
        }
    }
    const res = { ok: false };
    if (cache) cache.set(k, res);
    return res;
}