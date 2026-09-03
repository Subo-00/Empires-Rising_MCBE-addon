import { processRegion } from "./campRegionProcessor.js";
import { getRegionOrigin } from "./helpers/regionMath.js";
import { REGION_SCAN_RADIUS, REGION_SIZE } from "../config/camp/configCamp.js";



// Maximum number of regions processed concurrently.
// Each worker independently loads chunks and awaits results,
// so they do not block each other.
const MAX_CONCURRENT_WORKERS = 3;

// -------------------------------------------------------
// Queue + caches
// -------------------------------------------------------

// Priority queue of regions waiting to be processed.
// Each entry: { dimension, regionX, regionZ, key, priority }
// Sorted ascending by priority — lowest number = processed first.
// Priority is computed at enqueue time from distance + movement direction.
const pendingRegions = [];

// Keys of regions currently queued or actively being processed.
// Prevents the same region from being queued multiple times before
// the worker gets to it.
const activeRegions = new Set();

// Keys of regions confirmed as processed during this session.
// Once a region is known to have its CORE_BLOCK (or we successfully
// mark it), we add it here so future scans stop re-queueing it.
const processedRegionsCache = new Set();

// Number of regions currently being processed concurrently.
let activeWorkers = 0;

// -------------------------------------------------------
// Player movement tracking
// -------------------------------------------------------

// Stores the last known position of each player (by name) so we can
// estimate their movement direction between scan cycles.
// Format: Map<playerName, { x, z, regionX, regionZ }>
const playerLastPos = new Map();

// Returns a normalized movement direction vector {dx, dz} for a player,
// or null if we don't have a previous position yet or the player barely moved.
// dx and dz are in the range [-1, 1].
function getPlayerMovementDir(player) {
    const prev = playerLastPos.get(player.name);
    if (!prev) return null;

    const dx = player.location.x - prev.x;
    const dz = player.location.z - prev.z;
    const len = Math.sqrt(dx * dx + dz * dz);

    // If the player barely moved between scan cycles, don't trust the direction.
    // 8 blocks is roughly one step — anything less is noise.
    if (len < 8) return null;

    return { dx: dx / len, dz: dz / len };
}

// -------------------------------------------------------
// Priority queue helpers
// -------------------------------------------------------

// Builds a unique string key for a region in a dimension.
function makeRegionKey(dimension, regionX, regionZ) {
    return `${dimension.id}:${regionX},${regionZ}`;
}

// Inserts a job into pendingRegions in ascending priority order.
// We use insertion sort here because the queue is small (typically < 25 entries
// for a single player with REGION_SCAN_RADIUS=1) and we insert infrequently
// (every SCAN_INTERVAL_TICKS ticks per player).
function insertSorted(job) {
    let i = pendingRegions.length;
    while (i > 0 && pendingRegions[i - 1].priority > job.priority) {
        i--;
    }
    pendingRegions.splice(i, 0, job);
}

// Enqueues a region with a computed priority, or skips it if already known/queued.
//
// Priority formula:
//   base     = Chebyshev distance from player's region in region steps
//              (0 = player's own region, 1 = adjacent, etc.)
//   dirBonus = dot product of (region offset direction) with (player movement direction),
//              negated and scaled by 1.5
//              → regions ahead of the player get up to -1.5 (processed sooner)
//              → regions behind get up to +1.5 (processed later)
//              → regions to the side get ~0 bonus
//
// Lower priority number = processed sooner.
//
// Example: a region 1 step ahead scores 1 + (-1.5) = -0.5
//          a region 1 step to the side scores 1 + 0 = 1.0
//          a region 1 step behind scores 1 + 1.5 = 2.5
//
// Returns true if the region was queued, false if it was skipped.
function enqueueRegion(dimension, regionX, regionZ, playerRegionX, playerRegionZ, movementDir) {
    const key = makeRegionKey(dimension, regionX, regionZ);

    // Skip regions already confirmed as processed this session.
    if (processedRegionsCache.has(key)) return false;

    // Skip regions already queued or currently being processed.
    if (activeRegions.has(key)) return false;

    // Chebyshev distance in region steps (not blocks).
    const drx = (regionX - playerRegionX) / REGION_SIZE;
    const drz = (regionZ - playerRegionZ) / REGION_SIZE;
    const distScore = Math.max(Math.abs(drx), Math.abs(drz)); // 0..REGION_SCAN_RADIUS

    // Direction bonus: how much this region aligns with the player's movement.
    // Positive dot = region is ahead, negative = behind.
    // We negate so "ahead" lowers priority (processed sooner).
    let dirBonus = 0;
    if (movementDir) {
        const len = Math.sqrt(drx * drx + drz * drz);
        if (len > 0) {
            const dot = (drx / len) * movementDir.dx + (drz / len) * movementDir.dz;
            dirBonus = -dot * 1.5; // range: -1.5 (ahead) to +1.5 (behind)
        }
    }

    const priority = distScore + dirBonus;

    activeRegions.add(key);
    insertSorted({ dimension, regionX, regionZ, key, priority });
    return true;
}

// -------------------------------------------------------
// Worker
// -------------------------------------------------------

// Picks the next region from the front of the priority queue and processes it.
// Does nothing if all worker slots are full or the queue is empty.
//
// The inner async IIFE is fire-and-forget — we do NOT await it here.
// This lets the worker loop immediately start another region if slots are free,
// rather than waiting for the current one to finish.
async function processNextRegion() {
    if (activeWorkers >= MAX_CONCURRENT_WORKERS) return;
    if (pendingRegions.length === 0) return;

    const job = pendingRegions.shift();
    activeWorkers++;

    // Fire-and-forget: intentionally not awaited.
    (async () => {
        try {
            const result = await processRegion(job.dimension, job.regionX, job.regionZ);

            // If the region is confirmed processed (already had the core block,
            // or we successfully marked it), remember it in the session cache
            // so future scans don't re-queue it.
            if (result?.cacheProcessed) {
                processedRegionsCache.add(job.key);
            }

            // Only log worker-level messages for unusual outcomes.
            // Normal flow (spawned / marked_no_spawn) is logged inside processRegion.
            if (result?.status === "core_check_timeout") {
                // console.warn(`[scan] core-timeout ${job.key}`);
            } else if (result?.status === "mark_failed") {
                // console.warn(`[scan] mark-failed ${job.key}`);
            }
        } catch (error) {
            console.warn(`[scan] error ${job.key}: ${error}`);
        } finally {
            // Always release the slot and remove from active set,
            // even if processRegion threw.
            activeRegions.delete(job.key);
            activeWorkers--;
        }
    })();
}

export function scanTick(players) {

    const fullScanStart = Date.now();
    let totalQueued = 0;
    let totalActiveSkipped = 0;
    let totalProcessedSkipped = 0;

    for (const player of players) {
        const playerScanStart = Date.now();

        // Convert player block position → chunk → region origin (in chunk coords).
        const chunkX = Math.floor(player.location.x / 16);
        const chunkZ = Math.floor(player.location.z / 16);
        const { regionX: playerRegionX, regionZ: playerRegionZ } = getRegionOrigin(chunkX, chunkZ);

        // Compute movement direction from the player's position last scan cycle.
        // Returns null if the player hasn't moved enough to determine direction.
        const movementDir = getPlayerMovementDir(player);

        // Save current position for the next scan cycle's direction calculation.
        playerLastPos.set(player.name, {
            x: player.location.x,
            z: player.location.z,
            regionX: playerRegionX,
            regionZ: playerRegionZ,
        });

        let queued = 0;
        let activeSkipped = 0;
        let processedSkipped = 0;

        // Scan a square of regions centered on the player's current region.
        // rx=0, rz=0 = the player's own region.
        for (let rx = -REGION_SCAN_RADIUS; rx <= REGION_SCAN_RADIUS; rx++) {
            for (let rz = -REGION_SCAN_RADIUS; rz <= REGION_SCAN_RADIUS; rz++) {
                const regionX = playerRegionX + rx * REGION_SIZE;
                const regionZ = playerRegionZ + rz * REGION_SIZE;
                const key = makeRegionKey(player.dimension, regionX, regionZ);

                if (processedRegionsCache.has(key)) {
                    processedSkipped++;
                    continue;
                }

                if (activeRegions.has(key)) {
                    activeSkipped++;
                    continue;
                }

                if (enqueueRegion(
                    player.dimension,
                    regionX, regionZ,
                    playerRegionX, playerRegionZ,
                    movementDir
                )) {
                    queued++;
                }
            }
        }

        totalQueued += queued;
        totalActiveSkipped += activeSkipped;
        totalProcessedSkipped += processedSkipped;

        const playerScanMs = Date.now() - playerScanStart;
        const dirStr = movementDir
            ? `dir=(${movementDir.dx.toFixed(2)},${movementDir.dz.toFixed(2)})`
            : `dir=unknown`;

        // console.warn(
        //     `[scan] "${player.name}" region=(${playerRegionX},${playerRegionZ}) ${dirStr} ` +
        //     `queued=${queued} activeSkip=${activeSkipped} processedSkip=${processedSkipped} ` +
        //     `took=${playerScanMs}ms queue=${pendingRegions.length} cache=${processedRegionsCache.size}`
        // );
    }

    // const fullScanMs = Date.now() - fullScanStart;
    // console.warn(
    //     `[scan] full players=${players.length} queued=${totalQueued} ` +
    //     `activeSkip=${totalActiveSkipped} processedSkip=${totalProcessedSkipped} ` +
    //     `workers=${activeWorkers}/${MAX_CONCURRENT_WORKERS} ` +
    //     `took=${fullScanMs}ms queue=${pendingRegions.length} cache=${processedRegionsCache.size}`
    // );
}

export function workerTick() {
    for (let i = activeWorkers; i < MAX_CONCURRENT_WORKERS; i++) {
        if (pendingRegions.length === 0) break;
        processNextRegion();   // We intentionally do not await so multiple workers can start
    }
}