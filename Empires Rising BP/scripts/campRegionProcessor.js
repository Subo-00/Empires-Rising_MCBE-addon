import { system } from "@minecraft/server";
import { buildCamp } from "./campBuilder.js";
import { trackArea, untrackArea, makeTickingAreaName, getActiveAreaCount } from "./tickingAreaTracker.js";

// -------------------------------------------------------
// Constants
// -------------------------------------------------------

// Region size in chunks. 50x50 chunks = 800x800 blocks per region. Bigger regions = less camps placed worldwide.
export const REGION_SIZE = 90;

// Maximum ticking areas we allow ourselves to use globally (shared with campBuilder).
// MCBE hard limit is 10; we cap at 9 to leave 1 slot of headroom.
const MAX_TICKING_AREAS = 9;

// Same size in blocks, used for random position math.
const REGION_SIZE_BLOCKS = REGION_SIZE * 16;

// Permanent marker block placed at y=319 at the center of each processed region.
// Its presence means "this region has already been handled this world's lifetime."
const CORE_BLOCK = "subo:region_core";

// Y level where the core marker is placed and checked.
// 319 is the top of the world — well above any terrain, so it never conflicts.
const CORE_Y = 319;

// Minimum distance in blocks to keep from the region border when picking
// a random spawn candidate. Set to half the max village width so that no
// village can ever overlap into an adjacent region.
const REGION_BORDER_PADDING = 110;

// Vertical range scanned when searching for a valid spawn surface.
// We load 64..221 because:
//   - valid ground must be between y=64 and y=220
//   - we also load y=221 so we can confirm the top block is NOT above y=220
const SEARCH_MIN_Y = 64;
const SEARCH_MAX_Y = 221;
const VALID_MAX_SURFACE_Y = 220;

// Maximum number of random candidate positions tried per region before giving up.
const MAX_ATTEMPTS = 12;

// How many candidate positions are checked simultaneously per batch.
// With 3 concurrent regions, peak simultaneous chunk loads = 3 * 2 = 6.
// Keeping this at 2 keeps chunk load pressure predictable.
const ATTEMPTS_PER_BATCH = 2;

// Maximum ticks to wait for a chunk to become readable before timing out.
// 150 ticks = 7.5 seconds. Chunks that take longer are genuinely unreachable
// (too far from the player) and should be skipped rather than stalled on.
const MAX_LOAD_WAIT_TICKS = 150;

// -------------------------------------------------------
// Low-level helpers
// -------------------------------------------------------

// Resolves on the next game tick. Used to yield between batches so the
// script watchdog doesn't flag us for hogging the thread.
const nextTick = () => new Promise(resolve => system.run(resolve));

// Shorthand for wall-clock time in milliseconds, used for timing logs.
const now = () => Date.now();

// Returns true if the block at (x, y, z) can currently be read without throwing.
// Bedrock throws when a chunk is not loaded, so we use this as a load probe.
function isLocationLoaded(dimension, x, y, z) {
    try {
        return !!dimension.getBlock({ x, y, z });
    } catch {
        return false;
    }
}

// Polls once per tick until a location becomes readable, or times out.
// Resolves true if loaded in time, false if MAX_LOAD_WAIT_TICKS is exceeded.
const waitUntilLoaded = (dimension, x, y, z, maxChecks = MAX_LOAD_WAIT_TICKS) =>
    new Promise(resolve => {
        let checks = 0;
        const runId = system.runInterval(() => {
            checks++;
            if (isLocationLoaded(dimension, x, y, z)) {
                system.clearRun(runId);
                resolve(true);
                return;
            }
            if (checks >= maxChecks) {
                system.clearRun(runId);
                resolve(false);
            }
        }, 1);
    });


/**
 * Waits (polling every tick) until there is at least `needed` free TA slots.
 * Prevents the spawner from pushing the global TA count over the safe ceiling.
 */
const waitForTASlots = (needed = 1) =>
    new Promise(resolve => {
        const runId = system.runInterval(() => {
            if (getActiveAreaCount() + needed <= MAX_TICKING_AREAS) {
                system.clearRun(runId);
                resolve();
            }
        }, 1);
    });

// -------------------------------------------------------
// Ticking area helpers
// -------------------------------------------------------

// Returns the block-coordinate bounds of the chunk containing (x, z).
// Used to build the tickingarea add command with exact chunk boundaries.
function getChunkBounds(x, z) {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    return {
        minX: cx * 16,
        maxX: cx * 16 + 15,
        minZ: cz * 16,
        maxZ: cz * 16 + 15,
    };
}

// Adds a preload ticking area (the `true` flag) for the chunk containing (x, z),
// restricted to the vertical slice [minY..maxY] to minimize memory overhead.
// Returns the ticking area name so the caller can remove it when done.
function addChunkTickingArea(dimension, x, z, minY, maxY, prefix) {
    const safeName = makeTickingAreaName(prefix, x, z);
    trackArea(safeName);
    const bounds = getChunkBounds(x, z);
    dimension.runCommand(
        `tickingarea add ${bounds.minX} ${minY} ${bounds.minZ} ${bounds.maxX} ${maxY} ${bounds.maxZ} ${safeName} true`
    );
    return safeName;
}

// Removes a ticking area by name. Silently ignores errors (e.g. already removed).
function removeTickingArea(dimension, taName) {
    try {
        dimension.runCommand(`tickingarea remove ${taName}`);
        untrackArea(taName);
    } catch { }
}

// -------------------------------------------------------
// Region math
// -------------------------------------------------------

// Converts any chunk coordinate to the top-left chunk origin of its region.
// Exported so main.js can use it to map player chunk position → region.
export function getRegionOrigin(chunkX, chunkZ) {
    return {
        regionX: Math.floor(chunkX / REGION_SIZE) * REGION_SIZE,
        regionZ: Math.floor(chunkZ / REGION_SIZE) * REGION_SIZE,
    };
}

// Returns the center block (x, z) of a region.
// regionX / regionZ are the region origins in CHUNK coordinates.
// The center block is used as the location for the permanent core marker.
function getRegionCenterBlock(regionX, regionZ) {
    const centerChunkX = regionX + Math.floor(REGION_SIZE / 2);
    const centerChunkZ = regionZ + Math.floor(REGION_SIZE / 2);
    return {
        x: centerChunkX * 16 + 8,
        z: centerChunkZ * 16 + 8,
    };
}

// Returns one random block position (x, z) inside the region,
// inset by REGION_BORDER_PADDING blocks on all four sides.
// This guarantees a village centered here can never overlap into a neighboring region,
// as long as the village radius never exceeds REGION_BORDER_PADDING.
function randomPositionInRegion(regionX, regionZ) {
    const minX = regionX * 16 + REGION_BORDER_PADDING;
    const minZ = regionZ * 16 + REGION_BORDER_PADDING;
    const maxX = regionX * 16 + REGION_SIZE_BLOCKS - REGION_BORDER_PADDING;
    const maxZ = regionZ * 16 + REGION_SIZE_BLOCKS - REGION_BORDER_PADDING;

    return {
        x: Math.floor(minX + Math.random() * (maxX - minX)),
        z: Math.floor(minZ + Math.random() * (maxZ - minZ)),
    };
}

// Builds a batch of `count` random positions, trying to pick positions in
// different chunks so the batch checks are spread across the region rather
// than clustering in the same chunk (which would waste ticking area slots).
function randomBatchPositionsInRegion(regionX, regionZ, count) {
    const positions = [];
    const usedChunkKeys = new Set();
    let safety = 0;

    while (positions.length < count && safety < count * 20) {
        safety++;
        const pos = randomPositionInRegion(regionX, regionZ);
        const chunkKey = `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`;
        if (usedChunkKeys.has(chunkKey)) continue;
        usedChunkKeys.add(chunkKey);
        positions.push(pos);
    }

    // Fallback: if we couldn't find enough unique chunks (very small region),
    // just fill the rest with any random position.
    while (positions.length < count) {
        positions.push(randomPositionInRegion(regionX, regionZ));
    }

    return positions;
}

// -------------------------------------------------------
// Block-type helpers
// -------------------------------------------------------

// Returns true if the block type is a liquid (water or lava, flowing or still).
// Used to reject liquid surfaces as invalid spawn positions.
function isLiquidType(typeId) {
    return (
        typeId === "minecraft:water" ||
        typeId === "minecraft:flowing_water" ||
        typeId === "minecraft:lava" ||
        typeId === "minecraft:flowing_lava"
    );
}

// Scans downward from maxY to minY and returns the first non-air block found,
// or null if the entire column is air (or unloaded).
//
// We scan manually instead of using getTopmostBlock() because getTopmostBlock()
// was observed to always return y=319 when the chunk is freshly loaded via a
// ticking area — the heightmap isn't ready yet. Manual scanning reads real blocks.
function findTopNonAirBlockInRange(dimension, x, z, minY, maxY) {
    for (let y = maxY; y >= minY; y--) {
        const block = dimension.getBlock({ x, y, z });
        if (!block) continue;
        if (block.typeId !== "minecraft:air") {
            return { x, y, z, typeId: block.typeId };
        }
    }
    return null;
}

// -------------------------------------------------------
// Core block helpers
// -------------------------------------------------------

// Checks whether the region already has its permanent core marker at (coreX, CORE_Y, coreZ).
//
// Flow:
// 1. Add a ticking area for y=319 only (minimal footprint).
// 2. Wait until the chunk is readable.
// 3. Read the block and check if it's CORE_BLOCK.
// 4. Remove the ticking area.
//
// Returns { loaded, processed, ms }.
async function isRegionProcessed(dimension, coreX, coreZ) {
    const start = now();
    let taName;
    try {
        await waitForTASlots(1);
        // Only load y=319 — that's the only level we need for the core check.
        taName = addChunkTickingArea(dimension, coreX, coreZ, CORE_Y, CORE_Y, "corechk");
        const loaded = await waitUntilLoaded(dimension, coreX, CORE_Y, coreZ);
        if (!loaded) return { loaded: false, processed: false, ms: now() - start };

        let processed = false;
        try {
            const block = dimension.getBlock({ x: coreX, y: CORE_Y, z: coreZ });
            processed = block?.typeId === CORE_BLOCK;
        } catch { }

        return { loaded: true, processed, ms: now() - start };
    } catch {
        return { loaded: false, processed: false, ms: now() - start };
    } finally {
        if (taName) removeTickingArea(dimension, taName);
    }
}

// Places the permanent core marker at (coreX, CORE_Y, coreZ) to mark the region
// as processed for the lifetime of this world.
//
// Flow mirrors isRegionProcessed: load y=319, wait, setblock, remove ticking area.
//
// Returns { marked, ms }.
async function markRegionProcessed(dimension, coreX, coreZ) {
    const start = now();
    let taName;
    try {
        await waitForTASlots(1);
        taName = addChunkTickingArea(dimension, coreX, coreZ, CORE_Y, CORE_Y, "coremark");
        const loaded = await waitUntilLoaded(dimension, coreX, CORE_Y, coreZ);
        if (!loaded) return { marked: false, ms: now() - start };

        try {
            dimension.runCommand(`setblock ${coreX} ${CORE_Y} ${coreZ} ${CORE_BLOCK}`);
            return { marked: true, ms: now() - start };
        } catch {
            return { marked: false, ms: now() - start };
        }
    } catch {
        return { marked: false, ms: now() - start };
    } finally {
        if (taName) removeTickingArea(dimension, taName);
    }
}

// -------------------------------------------------------
// Random position validity check
// -------------------------------------------------------

// Checks one random candidate position (x, z) for spawn validity.
//
// Flow:
// 1. Add a ticking area for y=64..221 (the surface search range).
// 2. Wait until the chunk is readable.
// 3. Scan downward from 221 to 64 to find the top non-air block.
// 4. Reject if:
//    - chunk timed out (too far from player)
//    - no surface found in range (void, deep ocean floor below 64, etc.)
//    - surface is above y=220 (mountain / build height edge)
//    - surface is liquid (ocean, river, lava lake)
// 5. Remove the ticking area.
//
// Returns a detailed result object including timing info for logging.
async function getValidSpawnPosition(dimension, x, z) {
    const totalStart = now();
    let taName;
    let loadMs = 0;
    let scanMs = 0;

    try {
        await waitForTASlots(1);
        // Load only the vertical slice we actually need to scan.
        taName = addChunkTickingArea(dimension, x, z, SEARCH_MIN_Y, SEARCH_MAX_Y, "spawnchk");

        const loadStart = now();
        const loaded = await waitUntilLoaded(dimension, x, SEARCH_MIN_Y, z);
        loadMs = now() - loadStart;

        if (!loaded) return { ok: false, x, z, reason: "load_timeout", loadMs, scanMs, totalMs: now() - totalStart };

        const scanStart = now();
        const surface = findTopNonAirBlockInRange(dimension, x, z, SEARCH_MIN_Y, SEARCH_MAX_Y);
        scanMs = now() - scanStart;

        if (!surface) return { ok: false, x, z, reason: "no_surface_64_221", loadMs, scanMs, totalMs: now() - totalStart };

        // If the highest non-air block is at y=221, terrain is too high
        // (valid ground must be <= 220 so there's headroom above).
        if (surface.y > VALID_MAX_SURFACE_Y) return { ok: false, x, z, y: surface.y, blockTypeId: surface.typeId, reason: "surface_above_220", loadMs, scanMs, totalMs: now() - totalStart };

        // Reject water/lava surfaces — villages shouldn't spawn in oceans or lava lakes.
        if (isLiquidType(surface.typeId)) return { ok: false, x, z, y: surface.y, blockTypeId: surface.typeId, reason: "liquid_surface", loadMs, scanMs, totalMs: now() - totalStart };

        return { ok: true, x, z, pos: { x, y: surface.y, z }, blockTypeId: surface.typeId, loadMs, scanMs, totalMs: now() - totalStart };
    } catch {
        return { ok: false, x, z, reason: "exception", loadMs, scanMs, totalMs: now() - totalStart };
    } finally {
        if (taName) removeTickingArea(dimension, taName);
    }
}

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