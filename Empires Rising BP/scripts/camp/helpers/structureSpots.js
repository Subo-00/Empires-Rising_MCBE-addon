import {
    STRUCTURE_GAP,
} from "../../config/camp/configCamp.js";
import {
    int,
    boxesOverlap,
    resolveRequiredOverlapByPushingOut,
    weightedRandomPool,
    pickStructureForPlanning,
    getStructureSpotMetrics,
    isInsideSafeArea,
    getInteriorBounds,
} from "./smallHelpers.js";
import { REQUIRED_STRUCTURES, EXTRA_POOL_CANDIDATES, EXTRA_STRUCTURE_ATTEMPTS } from "../../config/camp/styleSystem.js";


export function generateStructureSpots(plan, activePools) {
    const spots = [];
    const placed = []; // { box }

    // ---- 1. Pick one required layout that actually fits using real picked structure sizes ----
    const layouts = REQUIRED_STRUCTURES[plan.size.key] ?? [[]];
    const shuffledLayouts = [...layouts].sort(() => Math.random() - 0.5);

    let acceptedRequired = null;

    for (const layout of shuffledLayouts) {
        const testSpots = [];
        const testPlaced = [];
        let layoutOk = true;

        for (const req of layout) {
            const absX = int(plan.center.x + req.x);
            const absZ = int(plan.center.z + req.z);

            const picked = pickStructureForPlanning(activePools, req.pool);
            const metrics = getStructureSpotMetrics(plan, req.pool, absX, absZ, picked);

            if (!metrics) {
                layoutOk = false;
                break;
            }

            // Instead of instantly discarding the whole layout on a collision,
            // push this structure straight outward from the camp center (away
            // from the boss/center building and any other required structure
            // already placed) until its real footprint clears them. This uses
            // the ACTUAL picked footprint (fw/fd), so it correctly accounts
            // for oversized boss variants (e.g. 35x50) as well as any large
            // "big"/"medium" companion structure.
            const resolved = resolveRequiredOverlapByPushingOut(
                plan, absX, absZ, metrics.fw, metrics.fd, testPlaced
            );

            if (!resolved.resolved) {
                layoutOk = false;
                break;
            }

            const finalX = resolved.x;
            const finalZ = resolved.z;
            const finalBox = resolved.box;

            if (!isInsideSafeArea(plan, finalX, finalZ, metrics.half)) {
                layoutOk = false;
                break;
            }

            testSpots.push({
                ...req,
                x: finalX,
                z: finalZ,
                picked: metrics.picked,
                rotation: metrics.rotation,
                fw: metrics.fw,
                fd: metrics.fd,
                foundationRadius: metrics.half,
                footprintBox: finalBox,
                index: testSpots.length,
            });

            testPlaced.push({ box: finalBox });
        }

        if (layoutOk) {
            acceptedRequired = { spots: testSpots, placed: testPlaced };
            break;
        }
    }

    if (!acceptedRequired) {
        console.warn(`[camp] No required layout fit for size=${plan.size.key} shape=${plan.shape.key}`);
        return [];
    }

    spots.push(...acceptedRequired.spots);
    placed.push(...acceptedRequired.placed);

    // ---- 2. Pack extra buildings, weighted toward bigger structures, but never boss ----
    const bounds = getInteriorBounds(plan);
    const maxExtra = EXTRA_STRUCTURE_ATTEMPTS[plan.size.key] ?? 3;

    const candidatePools = (EXTRA_POOL_CANDIDATES[plan.size.key] ?? ["medium", "small", "tiny", "tower", "small_tower"])
        .filter(p => p !== "boss")
        .filter(p => (activePools?.[p]?.length ?? 0) > 0);

    let extraPlaced = 0;
    const maxAttempts = maxExtra * 25;

    for (let attempt = 0; attempt < maxAttempts && extraPlaced < maxExtra; attempt++) {
        if (candidatePools.length === 0) break;

        const pool = weightedRandomPool(candidatePools);
        const picked = pickStructureForPlanning(activePools, pool);
        if (!picked) continue;

        // Rotation depends on chosen XZ, so first use max possible footprint for sampling safety.
        const roughHalf = Math.ceil(Math.max(picked.width, picked.depth) / 2);

        const rangeX = Math.max(0, bounds.maxX - bounds.minX - 2 * roughHalf);
        const rangeZ = Math.max(0, bounds.maxZ - bounds.minZ - 2 * roughHalf);
        if (rangeX <= 0 || rangeZ <= 0) continue;

        const x = int(bounds.minX + roughHalf + Math.random() * rangeX);
        const z = int(bounds.minZ + roughHalf + Math.random() * rangeZ);

        const metrics = getStructureSpotMetrics(plan, pool, x, z, picked);
        if (!metrics) continue;

        if (!isInsideSafeArea(plan, x, z, metrics.half)) continue;

        let ok = true;
        for (const p of placed) {
            if (boxesOverlap(metrics.box, p.box, STRUCTURE_GAP)) {
                ok = false;
                break;
            }
        }

        if (!ok) continue;

        spots.push({
            x,
            z,
            pool,
            required: false,
            picked: metrics.picked,
            rotation: metrics.rotation,
            fw: metrics.fw,
            fd: metrics.fd,
            foundationRadius: metrics.half,
            footprintBox: metrics.box,
            index: spots.length,
        });

        placed.push({ box: metrics.box });
        extraPlaced++;
    }

    return spots;
}