import { system, world } from "@minecraft/server";
import {
    RIFT_DIMENSION_ID,
    VALID_SPAWN_BLOCKS,
    ALLOWED_RIFT_MOBS,
    RIFT_MOB_TIERS,
    RIFT_SPAWN
} from "../config/rift/riftConfig.js";
import { getSpiritLevel } from "./riftSpirits.js";

// =============================================================================
// RIFT DIMENSION FORCED SPAWNS
// Adaptive ticker: slower + sparse at low spirit levels, fast + dense at high.
// Soft nearby-mob caps + multi-spawn per valid location keep multiplayer cheap.
// =============================================================================

let riftDimRunId = null;
let currentInterval = RIFT_SPAWN.intervalAt0;

/** Highest spirit level among vigor / pyro / frost (0–100). */
function getHighestSpiritLevel(player) {
    if (!player?.isValid) return 0;
    try {
        return Math.max(
            getSpiritLevel(player, "vigor"),
            getSpiritLevel(player, "pyro"),
            getSpiritLevel(player, "frost")
        );
    } catch {
        return 0;
    }
}

function lerp(a, b, t) {
    return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Weighted pool: Tier 0 always common; Tier 1 mid-game; Tier 2 late-game.
 */
function getSpawnWeights(level) {
    const t = level / RIFT_SPAWN.levelCap;
    const tierMult = [
        lerp(1.0, 0.50, t),
        lerp(0.12, 0.90, t),
        lerp(0.02, 1.15, t),
    ];

    const pool = [];
    for (let ti = 0; ti < RIFT_MOB_TIERS.length; ti++) {
        const mult = tierMult[ti];
        if (mult <= 0.001) continue;
        for (const entry of RIFT_MOB_TIERS[ti]) {
            if (!ALLOWED_RIFT_MOBS.has(entry.id)) continue;
            const w = entry.weight * mult;
            if (w > 0) pool.push({ id: entry.id, weight: w });
        }
    }
    return pool;
}

function pickWeighted(pool) {
    if (!pool.length) return null;
    let total = 0;
    for (const e of pool) total += e.weight;
    let roll = Math.random() * total;
    for (const e of pool) {
        roll -= e.weight;
        if (roll <= 0) return e.id;
    }
    return pool[pool.length - 1].id;
}

/** Count living monsters already near the player (soft population cap). */
function countNearbyMonsters(player, radius) {
    try {
        const ents = player.dimension.getEntities({
            location: player.location,
            maxDistance: radius,
            families: ["monster"]
        });
        let n = 0;
        for (const e of ents) {
            if (e.isValid) n++;
        }
        return n;
    } catch {
        return 0;
    }
}

/**
 * Find one valid ground spot, then spawn a small cluster there.
 * Reusing the spot avoids extra getBlock calls (cheap under load).
 * Returns how many mobs were actually spawned.
 */
function trySpawnCluster(player, minRange, maxRange, attempts, pool, clusterSize) {
    const dim = player.dimension;
    const loc = player.location;
    const playerY = Math.floor(loc.y);
    const rangeSpan = Math.max(0.5, maxRange - minRange);

    for (let attempt = 0; attempt < attempts; attempt++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = minRange + Math.random() * rangeSpan;
        const bx = Math.floor(loc.x + Math.cos(angle) * dist);
        const bz = Math.floor(loc.z + Math.sin(angle) * dist);

        for (let dy = -2; dy <= 2; dy++) {
            const groundY = playerY + dy;
            let ground, space1, space2;
            try {
                ground = dim.getBlock({ x: bx, y: groundY, z: bz });
                space1 = dim.getBlock({ x: bx, y: groundY + 1, z: bz });
                space2 = dim.getBlock({ x: bx, y: groundY + 2, z: bz });
            } catch {
                continue;
            }

            if (
                !ground ||
                !VALID_SPAWN_BLOCKS.has(ground.typeId) ||
                !space1?.isAir ||
                !space2?.isAir
            ) {
                continue;
            }

            // Valid spot found → drop a small cluster (same or adjacent air)
            let spawned = 0;
            const offsets = [
                { x: 0, z: 0 },
                { x: 1, z: 0 },
                { x: -1, z: 0 },
                { x: 0, z: 1 },
                { x: 0, z: -1 },
            ];

            for (let c = 0; c < clusterSize && c < offsets.length; c++) {
                const ox = bx + offsets[c].x;
                const oz = bz + offsets[c].z;
                try {
                    const g = dim.getBlock({ x: ox, y: groundY, z: oz });
                    const s1 = dim.getBlock({ x: ox, y: groundY + 1, z: oz });
                    const s2 = dim.getBlock({ x: ox, y: groundY + 2, z: oz });
                    if (
                        !g ||
                        !VALID_SPAWN_BLOCKS.has(g.typeId) ||
                        !s1?.isAir ||
                        !s2?.isAir
                    ) {
                        // Fall back to original cell for remaining members of the cluster
                        if (c === 0) continue;
                        const mobId = pickWeighted(pool);
                        if (!mobId) break;
                        dim.spawnEntity(mobId, {
                            x: bx + 0.5,
                            y: groundY + 1,
                            z: bz + 0.5
                        });
                        spawned++;
                        continue;
                    }
                    const mobId = pickWeighted(pool);
                    if (!mobId) break;
                    dim.spawnEntity(mobId, {
                        x: ox + 0.5,
                        y: groundY + 1,
                        z: oz + 0.5
                    });
                    spawned++;
                } catch { /* ignore single spawn fail */ }
            }
            return spawned;
        }
    }
    return 0;
}

/**
 * Spawn a level-scaled wave around one player, respecting soft nearby cap.
 */
function spawnForcedMobsAround(player) {
    if (!player?.isValid || player.dimension.id !== RIFT_DIMENSION_ID) return 0;

    const level = getHighestSpiritLevel(player);
    const t = level / RIFT_SPAWN.levelCap;

    const maxNearby = Math.round(lerp(RIFT_SPAWN.maxNearbyAt0, RIFT_SPAWN.maxNearbyAtMax, t));
    const already = countNearbyMonsters(player, RIFT_SPAWN.nearbyCheckRadius);
    if (already >= maxNearby) return 0;

    const countMin = Math.round(lerp(RIFT_SPAWN.countMinAt0, RIFT_SPAWN.countMinAtMax, t));
    const countMax = Math.round(lerp(RIFT_SPAWN.countMaxAt0, RIFT_SPAWN.countMaxAtMax, t));
    let want = countMin + Math.floor(Math.random() * (countMax - countMin + 1));
    // Don't overshoot the soft cap this cycle
    want = Math.min(want, maxNearby - already);

    const minRange = lerp(RIFT_SPAWN.minRangeAt0, RIFT_SPAWN.minRangeAtMax, t);
    const maxRange = RIFT_SPAWN.maxRange;
    const attempts = Math.round(lerp(RIFT_SPAWN.attemptsAt0, RIFT_SPAWN.attemptsAtMax, t));
    const clusterSize = Math.round(lerp(RIFT_SPAWN.clusterSizeAt0, RIFT_SPAWN.clusterSizeAtMax, t));

    const pool = getSpawnWeights(level);
    if (!pool.length) return 0;

    let totalSpawned = 0;
    // Each successful location yields up to clusterSize mobs
    while (totalSpawned < want) {
        const remaining = want - totalSpawned;
        const size = Math.min(clusterSize, remaining);
        const n = trySpawnCluster(player, minRange, maxRange, attempts, pool, size);
        if (n <= 0) break; // no valid ground found this cycle
        totalSpawned += n;
    }
    return totalSpawned;
}

/**
 * Restart the interval if the ideal period changed (high-level players need
 * a faster tick; low-level / empty dimension can stay slow).
 */
function ensureInterval(desired) {
    desired = Math.max(10, Math.round(desired));
    if (riftDimRunId !== null && desired === currentInterval) return;

    if (riftDimRunId !== null) {
        try { system.clearRun(riftDimRunId); } catch { }
        riftDimRunId = null;
    }
    currentInterval = desired;

    riftDimRunId = system.runInterval(() => {
        try {
            tickSpawns();
        } catch (e) {
            console.warn("[RiftSpawn] dimension ticker error", e);
        }
    }, currentInterval);
}

function tickSpawns() {
    const playersInRift = world.getPlayers().filter(
        p => p?.isValid && p.dimension.id === RIFT_DIMENSION_ID
    );

    if (playersInRift.length === 0) {
        // Idle slow: no need for a fast interval when the dimension is empty
        ensureInterval(RIFT_SPAWN.intervalAt0);
        return;
    }

    // Interval follows the *highest* spirit level currently inside
    let maxLevel = 0;
    for (const p of playersInRift) {
        maxLevel = Math.max(maxLevel, getHighestSpiritLevel(p));
    }
    const t = maxLevel / 100;
    const desired = lerp(RIFT_SPAWN.intervalAt0, RIFT_SPAWN.intervalAtMax, t);
    ensureInterval(desired);

    for (const player of playersInRift) {
        try {
            spawnForcedMobsAround(player);
        } catch (e) {
            console.warn("[RiftSpawn] spawnForcedMobsAround failed", e);
        }
    }
}

/** Start the dimension spawn ticker (idempotent). */
export function startRiftDimensionTicker() {
    ensureInterval(RIFT_SPAWN.intervalAt0);
}

export function stopRiftDimensionTicker() {
    if (riftDimRunId === null) return;
    try { system.clearRun(riftDimRunId); } catch { }
    riftDimRunId = null;
}