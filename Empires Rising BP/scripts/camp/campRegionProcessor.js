import { buildCamp } from "./campBuilder.js";

import {
    nextTick,
    now,
} from "./helpers/helpers.js";

import {
    getRegionCenterBlock,
    randomBatchPositionsInRegion,
} from "./helpers/regionMath.js";

import {
    isRegionProcessed,
    markRegionProcessed,
} from "./helpers/regionCore.js";

import {
    getValidSpawnPosition,
} from "./helpers/spawnValidation.js";


// Maximum number of random candidate positions tried per region before giving up.
const MAX_ATTEMPTS = 12;

// How many candidate positions are checked simultaneously per batch.
// With 3 concurrent regions, peak simultaneous chunk loads = 3 * 2 = 6.
// Keeping this at 2 keeps chunk load pressure predictable.
const ATTEMPTS_PER_BATCH = 2;

async function placeVillage(dimension, x, y, z) {
    const result = await buildCamp(dimension, x, y, z);

    return {
        placed: result.placed,
        ms: result.ms,
        reason: result.reason,
    };
}

// -------------------------------------------------------
// Main exported function
// -------------------------------------------------------

// Processes one region: checks if already processed, searches for a valid spawn
// position, marks the region as processed, and places the village if found.
//
// Flow:
// 1. Check the permanent core marker at the region center.
//    → Already processed: return early (cacheProcessed: true).
//    → Core chunk timed out: return early (cacheProcessed: false, will retry).
// 2. Search for a valid spawn position using batched random candidate checks.
//    → Batches of ATTEMPTS_PER_BATCH run concurrently via Promise.all.
//    → Stops as soon as one valid position is found.
//    → Gives up after MAX_ATTEMPTS total (mark cacheProcessed: true).
// 3. Mark the region as processed by placing the core block.
//    → If marking fails, return early (cacheProcessed: false, will retry).
// 4. If a valid spawn was found, place the village.
//
// Returns a status object so main.js can decide whether to add the key to
// processedRegionsCache.
export async function processRegion(dimension, regionX, regionZ) {

    const regionStart = now();
    const { x: coreX, z: coreZ } = getRegionCenterBlock(regionX, regionZ);
    const label = `region(${regionX},${regionZ}) center=(${coreX},${coreZ})`;

    // console.warn(`[region] START ${label}`);

    // ---------------------------------------------------
    // Step 1: check permanent core marker
    // ---------------------------------------------------
    const coreCheck = await isRegionProcessed(dimension, coreX, coreZ);

    if (!coreCheck.loaded) {
        // The core chunk couldn't be loaded in time. This usually means the region
        // center is too far from the player. Return without caching so it can be
        // retried when the player moves closer.
        const totalMs = now() - regionStart;
        // console.warn(`[region] WAIT  ${label} core-check-timeout | core=${coreCheck.ms}ms | total=${totalMs}ms`);
        return { status: "core_check_timeout", cacheProcessed: false, totalMs };
    }

    if (coreCheck.processed) {
        // Region was already processed in a previous session. Cache it so we
        // never queue it again this session.
        const totalMs = now() - regionStart;
        // console.warn(`[region] SKIP  ${label} already-processed | core=${coreCheck.ms}ms | total=${totalMs}ms`);
        return { status: "already_processed", cacheProcessed: true, totalMs };
    }

    // ---------------------------------------------------
    // Step 2: search for a valid spawn position
    // ---------------------------------------------------
    let spawnPos = null;
    let attemptsUsed = 0;
    const totalBatches = Math.ceil(MAX_ATTEMPTS / ATTEMPTS_PER_BATCH);

    for (let batchIndex = 0; batchIndex < totalBatches && !spawnPos; batchIndex++) {
        const remaining = MAX_ATTEMPTS - attemptsUsed;
        const batchSize = Math.min(ATTEMPTS_PER_BATCH, remaining);
        const batchStart = attemptsUsed + 1;
        const batchEnd = attemptsUsed + batchSize;

        // console.warn(`[region] BATCH ${label} attempts=${batchStart}-${batchEnd}/${MAX_ATTEMPTS} (${batchSize} at once)`);

        // Pick batchSize random positions, preferring different chunks.
        const candidates = randomBatchPositionsInRegion(regionX, regionZ, batchSize);

        // Check all candidates in this batch concurrently.
        // Each check independently loads its chunk, scans, and releases the ticking area.
        const results = await Promise.all(
            candidates.map(async (candidate, localIndex) => {
                const attemptNumber = attemptsUsed + localIndex + 1;
                const result = await getValidSpawnPosition(dimension, candidate.x, candidate.z);
                return { attemptNumber, ...result };
            })
        );

        // Sort by attempt number so logs appear in a predictable order,
        // regardless of which Promise resolved first.
        results.sort((a, b) => a.attemptNumber - b.attemptNumber);

        for (const result of results) {
            // Take the first valid position found; ignore subsequent valid ones.
            if (result.ok && !spawnPos) spawnPos = result.pos;

            if (result.ok) {
                // console.warn(
                //     `[region] POS   ${label} #${result.attemptNumber}/${MAX_ATTEMPTS} ` +
                //     `VALID at (${result.pos.x},${result.pos.y},${result.pos.z}) ` +
                //     `surface=${result.blockTypeId} load=${result.loadMs}ms scan=${result.scanMs}ms total=${result.totalMs}ms`
                // );
            } else {
                // console.warn(
                //     `[region] POS   ${label} #${result.attemptNumber}/${MAX_ATTEMPTS} ` +
                //     `invalid at (${result.x},?,${result.z}) reason=${result.reason} ` +
                //     `${result.y !== undefined ? `y=${result.y} ` : ""}` +
                //     `${result.blockTypeId ? `surface=${result.blockTypeId} ` : ""}` +
                //     `load=${result.loadMs}ms scan=${result.scanMs}ms total=${result.totalMs}ms`
                // );
            }
        }

        attemptsUsed += batchSize;

        // Yield one tick between batches to stay friendly to the watchdog.
        // Skip the yield on the last batch (no point yielding if we're done).
        if (!spawnPos && attemptsUsed < MAX_ATTEMPTS) await nextTick();
    }

    if (!spawnPos) {
        // console.warn(`[region] MISS  ${label} no-valid-position after ${MAX_ATTEMPTS} attempts`);
    }

    // ---------------------------------------------------
    // Step 3: mark region as processed
    // ---------------------------------------------------
    // Always mark, even if no valid spawn was found. This prevents the region
    // from being re-processed every time the player passes through.
    const markResult = await markRegionProcessed(dimension, coreX, coreZ);

    if (!markResult.marked) {
        // Marking failed (chunk timed out). Don't cache — allow a retry later.
        const totalMs = now() - regionStart;
        // console.warn(`[region] FAIL  ${label} could-not-mark-processed | mark=${markResult.ms}ms | total=${totalMs}ms`);
        return { status: "mark_failed", cacheProcessed: false, totalMs };
    }

    // console.warn(`[region] MARK  ${label} processed | mark=${markResult.ms}ms`);

    // ---------------------------------------------------
    // Step 4: place village if a valid spawn was found
    // ---------------------------------------------------
    if (spawnPos) {
        // console.warn(`[region] PLACE ${label} village at (${spawnPos.x},${spawnPos.y},${spawnPos.z})`);
        const placeResult = await placeVillage(dimension, spawnPos.x, spawnPos.y, spawnPos.z);

        if (placeResult.placed) {
            // console.warn(`[region] PLACE ${label} done | place=${placeResult.ms}ms`);
        } else {
            // console.warn(`[region] PLACE ${label} skipped reason=${placeResult.reason} | place=${placeResult.ms}ms`);
        }
    }

    const totalMs = now() - regionStart;
    // console.warn(`[region] DONE  ${label} status=${spawnPos ? "spawned" : "marked_no_spawn"} total=${totalMs}ms`);

    return { status: spawnPos ? "spawned" : "marked_no_spawn", cacheProcessed: true, totalMs };
}