import { system } from "@minecraft/server";
import {
    MIN_BUILD_Y, MAX_BUILD_Y, COMMANDS_PER_TICK,
    STRUCTURE_GAP, MAX_STRUCTURE_CORNER_DROP,
    STRUCTURE_SURROUND_FILL_HEIGHT, STRUCTURE_SURROUND_BLOCK,
    WALL_CLEARANCE, CORNER_EXTRA_CLEARANCE,
} from "../../config/camp/configCamp.js";
import {
    isAirType,
    isLiquidType,
    isLeavesType,
    isLogType,
    getBlockSafe,
    setBlock,
} from "./blockHelpers.js";
import {
    getPlanHalfExtents,
} from "./geometry.js";
import {
    EXTRA_POOL_WEIGHTS,
} from "../../config/camp/styleSystem.js";

export const nextTick = () => new Promise(resolve => system.run(resolve));
export const now = () => Date.now();

let _commandBudget = 0;

export function createPoolQueues(activePools) {
    const queues = {};
    for (const [key, pool] of Object.entries(activePools)) {
        queues[key] = { remaining: [...pool].sort(() => Math.random() - 0.5), used: [] };
    }
    return queues;
}

export function drawFromQueue(queues, poolKey) {
    const q = queues[poolKey];
    if (!q || (q.remaining.length === 0 && q.used.length === 0)) return null;

    if (q.remaining.length === 0) {
        // All used up — reshuffle and start again
        q.remaining = [...q.used].sort(() => Math.random() - 0.5);
        q.used = [];
    }

    const picked = q.remaining.pop();
    q.used.push(picked);
    return picked;
}

export function int(n) {
    return Math.floor(n);
}

export function clampY(y) {
    return Math.max(MIN_BUILD_Y, Math.min(MAX_BUILD_Y, Math.floor(y)));
}

export function key2(x, z) {
    return `${int(x)},${int(z)}`;
}

export function dist2D(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
}

export function makeOdd(n) {
    n = Math.max(1, Math.round(n));
    return n % 2 === 1 ? n : n + 1;
}

export function randomFromArray(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

// Bedrock structure rotation convention, assuming:
//   0_degrees   = exported structure's original orientation
//   90_degrees  = original front rotates south -> west
//   180_degrees = original front rotates south -> north
//   270_degrees = original front rotates south -> east
const _FACE_TO_DEGREES = {
    s: 0,
    w: 90,
    n: 180,
    e: 270,
};

const _DEGREES_TO_ROTATION = {
    0: "0_degrees",
    90: "90_degrees",
    180: "180_degrees",
    270: "270_degrees",
};

/**
 * Returns the structure-load rotation needed to make the structure's front
 * face from its placement spot toward the camp center.
 *
 * `savedFacing` is the front direction of the structure in its exported file.
 */
export function rotationTowardCampCenter(
    structureX,
    structureZ,
    campCenterX,
    campCenterZ,
    savedFacing = "s"
) {
    const dx = campCenterX - structureX;
    const dz = campCenterZ - structureZ;

    // A structure directly at the camp center has no meaningful direction.
    // Keep its exported orientation in that special case.
    if (dx === 0 && dz === 0) {
        return "0_degrees";
    }

    let desiredFacingDegrees;

    // Choose the cardinal direction that is closest to the center.
    if (Math.abs(dx) >= Math.abs(dz)) {
        // Camp center is primarily east or west of this structure.
        desiredFacingDegrees = dx > 0 ? 270 : 90;
    } else {
        // Camp center is primarily south or north of this structure.
        desiredFacingDegrees = dz > 0 ? 0 : 180;
    }

    const exportedFacingDegrees = _FACE_TO_DEGREES[savedFacing] ?? 0;

    // Rotate from the structure's exported front direction to its desired front direction.
    const rotationDegrees =
        (desiredFacingDegrees - exportedFacingDegrees + 360) % 360;

    return _DEGREES_TO_ROTATION[rotationDegrees];
}

export async function budgetYield() {
    _commandBudget++;
    if (_commandBudget >= COMMANDS_PER_TICK) {
        _commandBudget = 0;
        await nextTick();
    }
}

// Returns the XZ footprint after applying a structure rotation.
// 90/270 degrees swaps width <-> depth.
export function getRotatedFootprint(width, depth, rotation) {
    if (rotation === "90_degrees" || rotation === "270_degrees") {
        return { fw: depth, fd: width };
    }
    return { fw: width, fd: depth };
}

export function getCenteredFootprintBox(cx, cz, fw, fd, pad = 0) {
    const halfWNeg = Math.floor(fw / 2);
    const halfWPos = fw - 1 - halfWNeg;
    const halfDNeg = Math.floor(fd / 2);
    const halfDPos = fd - 1 - halfDNeg;

    return {
        minX: int(cx - halfWNeg - pad),
        maxX: int(cx + halfWPos + pad),
        minZ: int(cz - halfDNeg - pad),
        maxZ: int(cz + halfDPos + pad),
    };
}

export function boxesOverlap(a, b, gap = 0) {
    return (
        a.minX <= b.maxX + gap &&
        a.maxX >= b.minX - gap &&
        a.minZ <= b.maxZ + gap &&
        a.maxZ >= b.minZ - gap
    );
}

/**
 * Pushes a required structure straight outward from the camp center (along
 * its own placement vector) until its real footprint box no longer overlaps
 * any structure already accepted for this layout (with STRUCTURE_GAP
 * clearance). This is what actually guarantees required structures never
 * overlap each other or the center/boss building, regardless of which
 * random variant (and therefore real width/depth) got picked for either
 * structure — instead of just rejecting the whole layout the instant a
 * fixed-offset collision shows up.
 *
 * Since the push happens along the exact same direction from the camp
 * center, the structure's "face toward center" rotation stays correct —
 * only its distance from the center increases.
 */
export function resolveRequiredOverlapByPushingOut(plan, x, z, fw, fd, testPlaced, maxPushBlocks = 300) {
    let curX = x;
    let curZ = z;
    let box = getCenteredFootprintBox(curX, curZ, fw, fd);

    let overlapping = testPlaced.some(p => boxesOverlap(box, p.box, STRUCTURE_GAP));
    if (!overlapping) {
        return { x: curX, z: curZ, box, resolved: true };
    }

    // Direction to push: straight away from the camp center. If the
    // structure is exactly at the center (no direction), push along +X.
    let dx = x - plan.center.x;
    let dz = z - plan.center.z;
    let len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.0001) { dx = 1; dz = 0; len = 1; }
    const ux = dx / len;
    const uz = dz / len;

    for (let step = 1; step <= maxPushBlocks; step++) {
        curX = int(x + ux * step);
        curZ = int(z + uz * step);
        box = getCenteredFootprintBox(curX, curZ, fw, fd);

        overlapping = testPlaced.some(p => boxesOverlap(box, p.box, STRUCTURE_GAP));
        if (!overlapping) {
            return { x: curX, z: curZ, box, resolved: true };
        }
    }

    return { x: curX, z: curZ, box, resolved: false };
}

export function weightedRandomPool(poolKeys) {
    const candidates = poolKeys
        .map(key => ({ key, weight: Math.max(0, EXTRA_POOL_WEIGHTS[key] ?? 1) }))
        .filter(p => p.weight > 0);

    const total = candidates.reduce((sum, p) => sum + p.weight, 0);
    if (total <= 0) return randomFromArray(poolKeys);

    let roll = Math.random() * total;
    for (const p of candidates) {
        roll -= p.weight;
        if (roll <= 0) return p.key;
    }

    return candidates[candidates.length - 1].key;
}

export function pickStructureForPlanning(activePools, poolKey) {
    return randomFromArray(activePools?.[poolKey] ?? []);
}

export function getStructureSpotMetrics(plan, poolKey, x, z, picked) {
    if (!picked) return null;

    const rotation = rotationTowardCampCenter(
        x,
        z,
        plan.center.x,
        plan.center.z,
        picked.face
    );

    const { fw, fd } = getRotatedFootprint(picked.width, picked.depth, rotation);
    const half = Math.ceil(Math.max(fw, fd) / 2);
    const box = getCenteredFootprintBox(x, z, fw, fd);

    return { picked, rotation, fw, fd, half, box };
}

export function isSolidSurfaceBlock(block) {
    const typeId = block?.typeId ?? "minecraft:air";

    if (isAirType(typeId)) return false;
    if (isLiquidType(typeId)) return false;
    if (isLeavesType(typeId)) return false;
    if (isLogType(typeId)) return false;

    return block?.isLiquidBlocking("Water") === true;
}

export function hasSolidSurfaceWithinDrop(dimension, x, baseY, z, maxDrop = MAX_STRUCTURE_CORNER_DROP) {
    const startY = clampY(baseY - 1);
    const endY = clampY(baseY - maxDrop);

    for (let y = startY; y >= endY; y--) {
        const block = getBlockSafe(dimension, x, y, z);
        if (isSolidSurfaceBlock(block)) return true;
    }

    return false;
}

export function structureCornersHaveSupport(dimension, cx, baseY, cz, fw, fd) {
    const box = getCenteredFootprintBox(cx, cz, fw, fd);

    const corners = [
        { x: box.minX, z: box.minZ },
        { x: box.maxX, z: box.minZ },
        { x: box.minX, z: box.maxZ },
        { x: box.maxX, z: box.maxZ },
    ];

    for (const corner of corners) {
        if (!hasSolidSurfaceWithinDrop(dimension, corner.x, baseY, corner.z)) {
            return {
                ok: false,
                x: corner.x,
                z: corner.z,
                reason: "corner_too_high_above_solid_surface",
            };
        }
    }

    return { ok: true };
}

// Drops a support pillar straight down from topY-1 until it hits a
// non-air / non-liquid block (or the build floor).
// Returns the lowest Y that actually got a block placed (the pillar's bottom),
// so callers can know how deep this particular pillar had to go.
export async function placePillarDown(dimension, x, topY, z, logType) {
    let bottomY = topY - 1;
    for (let y = topY - 1; y >= MIN_BUILD_Y; y--) {
        const block = dimension.getBlock({ x: x, y: y, z: z });
        if (block?.isLiquidBlocking("Water")) { // this ignores any grass, kelp, water, air...
            bottomY = y + 1;
            break;
        }
        await setBlock(dimension, x, y, z, logType);
        bottomY = y;
    }
    return bottomY;
}

export async function fillAroundStructure(dimension, x, baseY, z, fw, fd) {
    const halfW_neg = Math.floor(fw / 2);
    const halfW_pos = fw - 1 - halfW_neg;
    const halfD_neg = Math.floor(fd / 2);
    const halfD_pos = fd - 1 - halfD_neg;

    const minX = x - halfW_neg - 1;
    const maxX = x + halfW_pos + 1;
    const minZ = z - halfD_neg - 1;
    const maxZ = z + halfD_pos + 1;

    const fillY1 = clampY(baseY);
    const fillY2 = clampY(baseY + STRUCTURE_SURROUND_FILL_HEIGHT);

    const replaceTargets = [
        "minecraft:water", "minecraft:lava",
        "minecraft:stone", "minecraft:dirt", "minecraft:grass_block",
        "minecraft:sand", "minecraft:gravel", "minecraft:mud",
        "minecraft:sandstone", "minecraft:snow", "minecraft:ice",
        "minecraft:packed_ice", "minecraft:blue_ice",
        "minecraft:diorite", "minecraft:granite", "minecraft:andesite",
    ];

    for (const target of replaceTargets) {
        dimension.runCommand(
            `fill ${minX} ${fillY1} ${minZ} ${maxX} ${fillY2} ${maxZ} ${STRUCTURE_SURROUND_BLOCK} replace ${target}`
        );
        await budgetYield();
    }
}

/**
 * Returns true if a vanilla villager exists within the given radius of (cx, cy, cz).
 * Uses a single entity query — no looping, very fast.
 */
export function isVillageNearby(dimension, cx, cy, cz, radius) {
    const entities = dimension.getEntities({
        type: "minecraft:villager",
        location: { x: cx, y: cy, z: cz },
        maxDistance: radius,
    });
    return entities.length > 0;
}

export function getInteriorBounds(plan) {
    // Still useful for the initial random sampling box
    const { halfW, halfD } = getPlanHalfExtents(plan, -WALL_CLEARANCE);
    return {
        minX: plan.center.x - halfW,
        maxX: plan.center.x + halfW,
        minZ: plan.center.z - halfD,
        maxZ: plan.center.z + halfD,
        // Extra info for circle checks
        radius: Math.floor(plan.size.diameter / 2) - WALL_CLEARANCE,
    };
}

/** Returns true if a building of the given half-size can sit at (x,z) */
export function isInsideSafeArea(plan, x, z, half) {
    if (plan.shape.key === "circle") {
        // True radial clearance
        const dist = dist2D(x, z, plan.center.x, plan.center.z);
        return dist + half <= (Math.floor(plan.size.diameter / 2) - WALL_CLEARANCE);
    }

    // Rectangle / square – axis-aligned + corner tightening
    const bounds = getInteriorBounds(plan);
    const distToWallX = Math.min(x - bounds.minX, bounds.maxX - x);
    const distToWallZ = Math.min(z - bounds.minZ, bounds.maxZ - z);

    if (distToWallX < half || distToWallZ < half) return false;

    // Stronger rejection near corners
    if (distToWallX < half + CORNER_EXTRA_CLEARANCE &&
        distToWallZ < half + CORNER_EXTRA_CLEARANCE) {
        return false;
    }
    return true;
}

/**
 * Returns true if any player is within `radius` of (cx, cy, cz).
 * Uses a single query — cheap.
 */
export function isPlayerNearby(dimension, cx, cy, cz, radius = 500) {
    // return false;  // for testing prpss
    try {
        const players = dimension.getPlayers({
            location: { x: cx, y: cy, z: cz },
            maxDistance: radius,
        });
        return players.length > 0;
    } catch {
        return false; // safer to continue than to hard-fail on API edge cases
    }
}

// Removes dropped items inside the same volume used by deforestation). Does not touch mobs.
export async function clearDropsInArea(dimension, minX, minY, minZ, maxX, maxY, maxZ) {
    const t0 = now();

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    // sphere that fully covers the box
    const radius = Math.ceil(
        Math.sqrt(
            Math.pow((maxX - minX) / 2, 2) +
            Math.pow((maxY - minY) / 2, 2) +
            Math.pow((maxZ - minZ) / 2, 2)
        )
    ) + 2;

    const dropTypes = ["minecraft:item", "minecraft:xp_orb"];
    let removed = 0;

    for (const type of dropTypes) {
        let entities;
        try {
            entities = dimension.getEntities({
                type,
                location: { x: cx, y: cy, z: cz },
                maxDistance: radius,
            });
        } catch {
            continue;
        }

        for (const e of entities) {
            // tight AABB filter so we don't delete drops outside the real box
            const loc = e.location;
            if (
                loc.x < minX || loc.x > maxX ||
                loc.y < minY || loc.y > maxY ||
                loc.z < minZ || loc.z > maxZ
            ) continue;

            try {
                e.remove();
                removed++;
            } catch { /* already gone */ }
        }
        await budgetYield(); // stay under command budget if many drops
    }
}