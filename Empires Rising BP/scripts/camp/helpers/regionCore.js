import {
    now,
} from "./helpers.js";
import {
    waitForTASlots,
    addChunkTickingArea,
    removeTickingArea,
    waitUntilLoaded,
} from "./tickingAreas.js";


// Permanent marker block placed at y=319 at the center of each processed region.
// Its presence means "this region has already been handled this world's lifetime."
const CORE_BLOCK = "subo:region_core";

// Y level where the core marker is placed and checked.
// 319 is the top of the world — well above any terrain, so it never conflicts.
const CORE_Y = 319;


// Checks whether the region already has its permanent core marker at (coreX, CORE_Y, coreZ).
//
// Flow:
// 1. Add a ticking area for y=319 only (minimal footprint).
// 2. Wait until the chunk is readable.
// 3. Read the block and check if it's CORE_BLOCK.
// 4. Remove the ticking area.
//
// Returns { loaded, processed, ms }.
export async function isRegionProcessed(dimension, coreX, coreZ) {
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
export async function markRegionProcessed(dimension, coreX, coreZ) {
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