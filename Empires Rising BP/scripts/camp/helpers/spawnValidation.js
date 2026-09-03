import {
    now,
} from "./helpers.js";
import {
    isLiquidType,
} from "./blockHelpers.js";
import {
    waitForTASlots,
    addChunkTickingArea,
    removeTickingArea,
    waitUntilLoaded,
} from "./tickingAreas.js";


// Vertical range scanned when searching for a valid spawn surface.
// We load 64..221 because:
//   - valid ground must be between y=64 and y=220
//   - we also load y=221 so we can confirm the top block is NOT above y=220
const SEARCH_MIN_Y = 64;
const SEARCH_MAX_Y = 221;
const VALID_MAX_SURFACE_Y = 220;

// -------------------------------------------------------
// Block-type helper
// -------------------------------------------------------

// Scans downward from maxY to minY and returns the first non-air block found,
// or null if the entire column is air (or unloaded).
//
// We scan manually instead of using getTopmostBlock() because getTopmostBlock()
// was observed to always return y=319 when the chunk is freshly loaded via a
// ticking area — the heightmap isn't ready yet. Manual scanning reads real blocks.
export function findTopNonAirBlockInRange(dimension, x, z, minY, maxY) {
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
export async function getValidSpawnPosition(dimension, x, z) {
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