
import { isLiquidType } from "./helpers/blockHelpers.js";

import {
    MAX_STRUCTURE_Y_DELTA,
    TOWER_MAX_FOOTPRINT,
    DEFOREST_PAD,
    DEFAULT_SUPPORT_BLOCK
} from "../config/camp/configCamp.js";

import {
    pickStyle,
    buildActivePools
} from "../config/camp/styleSystem.js";

import {
    nextTick,
    now,
    createPoolQueues,
    isPlayerNearby,
    isVillageNearby,
    clearDropsInArea,
    structureCornersHaveSupport
} from "./helpers/smallHelpers.js";

import {
    waitForBuildSlot,
    releaseBuildSlot,
    addTickingArea,
    removeTickingArea,
    chooseRandomCampSize,
    getCandidateSizes,
    getCampLoadSpan,
    getRequiredStripCount,
    waitUntilAllLoaded,
} from "./helpers/tickingAreas.js";

import {
    getGroundY,
    chooseCampPlan,
} from "./helpers/planValidation.js";

import {
    deforestAreaForPlan,
} from "./helpers/deforest.js";

import {
    placeInteriorPlatform,
    placeInteriorPlatformPillars,
} from "./helpers/interiorPlatform.js";

import {
    placeWalls,
} from "./helpers/walls.js";

import {
    placeGates,
    placeTowers,
    placeStructures,
} from "./helpers/structuresTowers.js";

export async function buildCamp(dimension, centerX, centerY, centerZ) {
    const start = now();
    let persistentAreas = null;

    // Abort early if a player could see the generation
    if (isPlayerNearby(dimension, centerX, centerY, centerZ, 500)) {
        console.warn(
            `[camp] EARLY SKIP: player within 500 blocks of ${centerX},${centerY},${centerZ}`
        );
        return { placed: false, reason: "player_nearby" };
    }

    const requestedSize = chooseRandomCampSize();
    const loadSpan = getCampLoadSpan(requestedSize);
    const stripCount = getRequiredStripCount(loadSpan);
    if (stripCount === null) { /* ... */ }

    const scanRadius = (loadSpan - 1) / 2;

    // ---- wait for slot ----
    const tSlot = now();
    await waitForBuildSlot(stripCount);
    const slotMs = now() - tSlot;

    try {
        // ---- ticking area ----
        const tArea = now();
        persistentAreas = await addTickingArea(
            dimension,
            centerX - scanRadius, centerY - 60, centerZ - scanRadius,
            centerX + scanRadius, centerY + 60, centerZ + scanRadius,
            "camp_build",
            stripCount
        );

        const finalProbes = [];
        const step = 24;
        for (let x = centerX - scanRadius; x <= centerX + scanRadius; x += step) {
            for (let z = centerZ - scanRadius; z <= centerZ + scanRadius; z += step) {
                finalProbes.push({ x, y: centerY, z });
            }
        }
        const ready = await waitUntilAllLoaded(dimension, finalProbes, 60);
        const areaMs = now() - tArea;

        if (!ready) {
            console.warn(`[camp] Final load check failed ... total=${areaMs}ms strips=${stripCount}`);
            return { placed: false };
        }
        for (let i = 0; i < 4; i++) await nextTick();

        console.warn(
            `[camp] AREA loaded size=${requestedSize.key} span=${loadSpan} ` +
            `strips=${stripCount} areaMs=${areaMs}ms slotMs=${slotMs}ms`
        );

        if (isPlayerNearby(dimension, centerX, centerY, centerZ, 500)) {
            return { placed: false, reason: "player_nearby" };
        }

        // style / pools must be chosen before planning, because planning now uses real structure sizes
        let biomeId = "plains";
        try {
            biomeId = dimension.getBiome({ x: centerX, y: centerY, z: centerZ })?.id ?? "plains";
        } catch { }

        const styleKey = pickStyle(biomeId);
        const foundationBlock = DEFAULT_SUPPORT_BLOCK;
        const activePools = buildActivePools(styleKey);
        const poolQueues = createPoolQueues(activePools);

        // ---- plan / terrain validation ----
        const tPlan = now();
        const candidateSizes = getCandidateSizes(requestedSize);
        const groundCache = new Map();
        const choice = await chooseCampPlan(
            dimension,
            centerX,
            centerY,
            centerZ,
            candidateSizes,
            groundCache,
            activePools
        );
        const planMs = now() - tPlan;

        if (!choice.ok) {
            console.warn(`[camp] FAIL: ${choice.reason} planMs=${planMs}ms`);
            return { placed: false };
        }
        const { plan } = choice;



        const halfD = Math.floor(plan.size.diameter / 2) + TOWER_MAX_FOOTPRINT + DEFOREST_PAD;

        if (isVillageNearby(dimension, centerX, centerY, centerZ, halfD + 15)) {
            console.warn(`[CampBuilder] Skipped camp at ${centerX},${centerY},${centerZ} — village nearby.`);
            return { placed: false, reason: "village_nearby" };
        }

        // ---- deforest ----
        const tDeforest = now();
        await deforestAreaForPlan(dimension, plan, centerX, centerY, centerZ);
        const deforestMs = now() - tDeforest;

        // ---- platform + pillars ----
        const tPlatform = now();
        const minAllowedPlatformY = plan.center.y - MAX_STRUCTURE_Y_DELTA;
        let platformY = plan.center.y;
        for (const spot of plan.validStructureSpots) {
            const top = getGroundY(dimension, spot.x, spot.z, plan.center.y, groundCache);
            if (top.ok && top.y < platformY) platformY = top.y;
        }
        platformY = Math.max(minAllowedPlatformY, platformY);

        await placeInteriorPlatform(dimension, plan, platformY);
        await placeInteriorPlatformPillars(dimension, plan, platformY);
        const platformMs = now() - tPlatform;

        // revalidate invalid spots (usually cheap)
        const tReval = now();
        for (const spot of plan.invalidStructureSpots) {
            const top = getGroundY(dimension, spot.x, spot.z, plan.center.y);
            if (!top.ok) continue;
            if (isLiquidType(top.typeId)) continue;
            if (Math.abs(top.y - plan.center.y) > MAX_STRUCTURE_Y_DELTA) continue;

            const baseY = top.y + 1;
            const cornerSupport = structureCornersHaveSupport(
                dimension,
                spot.x,
                baseY,
                spot.z,
                spot.fw,
                spot.fd
            );

            if (!cornerSupport.ok) continue;

            plan.validStructureSpots.push({
                ...spot,
                suitable: true,
                y: top.y,
                blockTypeId: top.typeId,
            });
        }
        const revalMs = now() - tReval;

        // ---- walls / gates / towers / structs (you already have these) ----
        const t0 = now();
        for (let li = 0; li < plan.wallLayers.length; li++) {
            await placeWalls(dimension, plan, foundationBlock, platformY, plan.wallLayers[li]);
        }
        const wallMs = now() - t0;

        const tGates = now();
        await placeGates(dimension, plan, platformY);
        const gateMs = now() - tGates;

        const t1 = now();
        await placeTowers(dimension, plan, foundationBlock, platformY, activePools, poolQueues);
        const towerMs = now() - t1;

        const t2 = now();
        await placeStructures(dimension, plan, activePools, poolQueues, platformY);
        const structMs = now() - t2;

        const tDrops = now();
        await clearDropsInArea(
            dimension,
            centerX - halfD, centerY - MAX_STRUCTURE_Y_DELTA - 10, centerZ - halfD,
            centerX + halfD, centerY + 70, centerZ + halfD
        );
        const dropsMs = now() - tDrops;

        const totalMs = now() - start;
        const accounted =
            slotMs + areaMs + planMs + deforestMs + platformMs + revalMs +
            wallMs + gateMs + towerMs + structMs + dropsMs;
        const unaccounted = totalMs - accounted;

        console.warn(
            `[camp] DONE requested=${requestedSize.key} actual=${plan.size.key} in ${totalMs}ms | ` +
            `slot=${slotMs} area=${areaMs} plan=${planMs} deforest=${deforestMs} ` +
            `platform=${platformMs} reval=${revalMs} ` +
            `walls=${wallMs} gates=${gateMs} towers=${towerMs} structs=${structMs} ` +
            `drops=${dropsMs} unaccounted=${unaccounted}`
        );

        return { placed: true, ms: totalMs };

    } catch (e) {
        console.warn(`[camp] ERROR: ${e}`);
        return { placed: false };
    } finally {
        if (persistentAreas) removeTickingArea(dimension, persistentAreas);
        releaseBuildSlot();
    }
}