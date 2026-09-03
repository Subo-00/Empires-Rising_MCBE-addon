import { system } from "@minecraft/server";
import {
    MAX_LOAD_WAIT_TICKS,
    TA_SAFE_MAX_SPAN,
    TOWER_MAX_FOOTPRINT,
    DEFOREST_PAD,
    _MAX_REGION_TICKING_AREAS,
    MAX_CONCURRENT_BUILDS,
    MAX_TICKING_AREAS,
    MAX_TA_SLOTS_PER_BUILD,
} from "../../config/camp/configCamp.js";
import { nextTick, int, clampY } from "./smallHelpers.js";
import { trackArea, untrackArea, makeTickingAreaName, getActiveAreaCount } from "./tickingAreaTracker.js";
import { CAMP_SIZES } from "../../config/camp/styleSystem.js";


export function isLocationLoaded(dimension, x, y, z) {
    try {
        // Preferred (1.21+): explicit chunk check
        if (typeof dimension.isChunkLoaded === "function") {
            return dimension.isChunkLoaded({ x: int(x), y: clampY(y), z: int(z) });
        }
        // Fallback
        console.warn(dimension, "FALLBACK TO OLD getBlock LOAD CHECK!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

        const block = dimension.getBlock({ x: int(x), y: clampY(y), z: int(z) });
        return !!block && (block.isValid !== false);
    } catch {
        return false;
    }
}

export function removeTickingArea(dimension, nameOrNames) {
    const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
    for (const name of names) {
        try {
            dimension.runCommand(`tickingarea remove ${name}`);
            untrackArea(name);
        } catch { }
    }
}

// Polls once per tick until a location becomes readable, or times out.
// Resolves true if loaded in time, false if MAX_LOAD_WAIT_TICKS is exceeded.
export const waitUntilLoaded = (dimension, x, y, z, maxChecks = MAX_LOAD_WAIT_TICKS) =>
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

// Split into 3 horizontal Z-strips, check corners of each strip:
/**
 * Waits until ALL of the given probe points are loaded.
 * Resolves true if all loaded within maxChecks ticks, false on timeout.
 */
export const waitUntilAllLoaded = (dimension, probes, maxChecks = MAX_LOAD_WAIT_TICKS) =>
    new Promise(resolve => {
        let checks = 0;
        const runId = system.runInterval(() => {
            checks++;
            const allLoaded = probes.every(p => isLocationLoaded(dimension, p.x, p.y, p.z));
            if (allLoaded) {
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
 * Returns the required load span (inclusive block count) for a given camp size.
 * Accounts for wall radius + tower footprint overhang + deforestation padding.
 */
export function getCampLoadSpan(sizeDef) {
    const reach = Math.floor(sizeDef.diameter / 2) + TOWER_MAX_FOOTPRINT + DEFOREST_PAD;
    return reach * 2 + 1;   // inclusive span
}

/**
 * Returns how many Z-strips are needed to keep each ticking area under
 * 100 chunks, given an inclusive block span.
 * Uses the guaranteed-safe thresholds from TA_SAFE_MAX_SPAN.
 * Returns null if the span is too large for even MAX_TA_SLOTS_PER_BUILD strips.
 */
export function getRequiredStripCount(span) {
    for (const { strips, maxSpan } of TA_SAFE_MAX_SPAN) {
        if (span <= maxSpan) return strips;
    }

    return null;   // caller must fall back to a smaller camp
}

/**
 * Randomly picks a camp size using weighted random selection.
 */
export function chooseRandomCampSize() {
    const total = CAMP_SIZES.reduce((sum, s) => sum + Math.max(0, s.weight ?? 0), 0);
    if (total <= 0) return randomFromArray(CAMP_SIZES);
    let roll = Math.random() * total;
    for (const size of CAMP_SIZES) {
        roll -= Math.max(0, size.weight ?? 0);
        if (roll <= 0) return size;
    }
    return CAMP_SIZES[CAMP_SIZES.length - 1];
}

/**
 * Returns all camp sizes with diameter <= the given size's diameter,
 * sorted biggest first (for fallback terrain validation).
 */
export function getCandidateSizes(initialSizeDef) {
    return [...CAMP_SIZES]
        .filter(s => s.diameter <= initialSizeDef.diameter)
        .sort((a, b) => b.diameter - a.diameter);
}

/**
 * Waits (polling every tick) until there is at least `needed` free TA slots.
 * Prevents the spawner from pushing the global TA count over the safe ceiling.
 */
export const waitForTASlots = (needed = 1) =>
    new Promise(resolve => {
        const runId = system.runInterval(() => {
            if (getActiveAreaCount() + needed <= _MAX_REGION_TICKING_AREAS) {
                system.clearRun(runId);
                resolve();
            }
        }, 1);
    });


/**
 * Creates 1, 2, or 3 ticking areas (Z-strips) to cover the given box.
 * stripCount must be 1, 2, or 3. Each strip is guaranteed ≤ 100 chunks
 *
 * Returns an array of TA name strings for later removal.
 */
export async function addTickingArea(dimension, minX, minY, minZ, maxX, maxY, maxZ, baseName, stripCount = 1) {
    const totalZ = maxZ - minZ + 1;   // inclusive span
    const stripSpan = Math.ceil(totalZ / stripCount);
    const names = [];
    const strips = [];

    for (let i = 0; i < stripCount; i++) {
        const z0 = minZ + i * stripSpan;
        const z1 = Math.min(z0 + stripSpan - 1, maxZ);
        strips.push({ z0, z1 });
    }

    const centerX = int((minX + maxX) / 2);

    for (let i = 0; i < strips.length; i++) {
        const { z0, z1 } = strips[i];
        const centerZ = int((z0 + z1) / 2);
        const safeName = makeTickingAreaName(
            stripCount === 1 ? baseName : `${baseName}_s${i}`,
            centerX,
            centerZ
        );

        dimension.runCommand(
            `tickingarea add ${int(minX)} ${clampY(minY)} ${int(z0)} ` +
            `${int(maxX)} ${clampY(maxY)} ${int(z1)} ${safeName} true`
        );

        trackArea(safeName);
        names.push({ name: safeName, z0, z1 });
    }

    const probeY = clampY(minY + 30);          // mid-height of the TA box is safer
    const probes = [];

    // Corners of every strip
    for (const { z0, z1 } of strips) {
        probes.push({ x: int(minX), y: probeY, z: int(z0) });
        probes.push({ x: int(maxX), y: probeY, z: int(z0) });
        probes.push({ x: int(minX), y: probeY, z: int(z1) });
        probes.push({ x: int(maxX), y: probeY, z: int(z1) });
    }

    // Extra interior samples (grid) so the middle of large camps is also forced loaded
    const stepX = Math.max(16, Math.floor((maxX - minX) / 4));
    const stepZ = Math.max(16, Math.floor((maxZ - minZ) / 4));
    for (let x = minX; x <= maxX; x += stepX) {
        for (let z = minZ; z <= maxZ; z += stepZ) {
            probes.push({ x: int(x), y: probeY, z: int(z) });
        }
    }
    // Always include exact center
    probes.push({
        x: int((minX + maxX) / 2),
        y: probeY,
        z: int((minZ + maxZ) / 2),
    });

    const allLoaded = await waitUntilAllLoaded(dimension, probes, MAX_LOAD_WAIT_TICKS);

    if (!allLoaded) {
        console.warn(`[camp] TA probes timed out – continuing anyway (may cause partial builds)`);
    }

    // Extra settle ticks – terrain / lighting / liquid simulation need a moment
    // even after the chunk is “loaded”.
    for (let i = 0; i < 8; i++) await nextTick();

    return names.map(n => n.name);
}

// Returns the block-coordinate bounds of the chunk containing (x, z).
// Used to build the tickingarea add command with exact chunk boundaries.
export function getChunkBounds(x, z) {
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
export function addChunkTickingArea(dimension, x, z, minY, maxY, prefix) {
    const safeName = makeTickingAreaName(prefix, x, z);
    trackArea(safeName);
    const bounds = getChunkBounds(x, z);
    dimension.runCommand(
        `tickingarea add ${bounds.minX} ${minY} ${bounds.minZ} ${bounds.maxX} ${maxY} ${bounds.maxZ} ${safeName} true`
    );
    return safeName;
}

// -------------------------------------------------------
// Global build concurrency gate
// -------------------------------------------------------

let _activeBuildCount = 0;

/**
 * Waits (polling every tick) until both conditions are true:
 *   1. Fewer than MAX_CONCURRENT_BUILDS camps are currently building.
 *   2. There are enough free TA slots for the requested amount.
 * This prevents ever exceeding the MCBE ticking area hard limit of 10.
 */
export async function waitForBuildSlot(requiredSlots = MAX_TA_SLOTS_PER_BUILD) {
    while (
        _activeBuildCount >= MAX_CONCURRENT_BUILDS ||
        getActiveAreaCount() + requiredSlots > MAX_TICKING_AREAS
    ) {
        await nextTick();
    }
    _activeBuildCount++;
}

export function releaseBuildSlot() {
    _activeBuildCount = Math.max(0, _activeBuildCount - 1);
}
