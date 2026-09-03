import {
    GATE_STRUCTURE_ID,
    GATE_WIDTH,
    GATE_DEPTH,
    GATE_COUNT,
    WALL_TOWER_OUTSET,
    WALL_LAYER_SPACING,
    TOWER_NEGATIVE_Y_ALLOWANCE,
    INTERIOR_PLATFORM_BLOCK,
    WALL_BLOCK,
    MAX_STRUCTURE_Y_DELTA,
} from "../../config/camp/configCamp.js";
import {
    int,
    clampY,
    budgetYield,
    nextTick,
    randomFromArray,
    rotationTowardCampCenter,
    getRotatedFootprint,
    drawFromQueue,
    fillAroundStructure,
    structureCornersHaveSupport,
    dist2D,
} from "./helpers.js";
import {
    isAirType,
    isLiquidType,
    getBlockTypeSafe,
    getBlockSafe,
} from "./blockHelpers.js";
import {
    placeSupportPlatform,
} from "./supportsPlatforms.js";
import {
    getGroundY,
} from "./planValidation.js";
import {
    getPlanHalfExtents,
    rectangleDepth,
} from "./geometry.js";


export async function placeStructureFromPool(dimension, poolKey, x, groundY, z, preferredRotation = null, activePools = null, prePicked = null) {
    const pool = activePools?.[poolKey] ?? [];
    const picked = prePicked ?? randomFromArray(pool);

    if (!picked) {
        return { placed: false, reason: `empty_pool_${poolKey}` };
    }

    const { width = 1, depth = 1 } = picked;
    const yOffset = 1;
    const rotation = preferredRotation ?? "0_degrees";

    // Center using the rotated footprint so placement lines up with the foundation
    const { fw, fd } = getRotatedFootprint(width, depth, rotation);

    const placeX = int(x - Math.floor(fw / 2));
    const placeY = int(groundY + yOffset);
    const placeZ = int(z - Math.floor(fd / 2));

    dimension.runCommand(
        `structure load ${picked.id} ${placeX} ${placeY} ${placeZ} ${rotation} none`
    );
    await budgetYield();

    return { placed: true, id: picked.id, rotation };
}

/**
 * Outward unit normal for a wall point.
 * - Circle: true radial direction from center (correct there).
 * - Square/Rectangle: axis-aligned normal perpendicular to the nearest wall
 *   face, so corner towers keep the same gap from the wall as mid-wall towers
 *   instead of being pulled in diagonally.
 */
export function getWallOutwardNormal(px, pz, cx, cz, plan) {
    const dx = px - cx;
    const dz = pz - cz;

    if (plan.shape.key === "circle") {
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len === 0) return { nx: 0, nz: 0 };
        return { nx: dx / len, nz: dz / len };
    }

    const { halfW, halfD } = getPlanHalfExtents(plan);

    const relX = halfW === 0 ? 0 : Math.abs(dx) / halfW;
    const relZ = halfD === 0 ? 0 : Math.abs(dz) / halfD;

    // Whichever face the point is closest to determines the push direction.
    if (relX >= relZ) {
        return { nx: Math.sign(dx) || 1, nz: 0 };
    }
    return { nx: 0, nz: Math.sign(dz) || 1 };
}

/**
 * Places 1–4 gates on the cardinal sides of the outermost wall.
 * For every selected side the same gate is also placed on every inner wall layer
 * so the opening goes cleanly through the whole multi-layer wall.
 * Gate Y is taken from the innermost layer so all layers line up.
 * Structure is 4×4×1; rotated 90° only on the east/west sides.
 */
export async function placeGates(dimension, plan, platformY) {
    const desired = GATE_COUNT[plan.size.key] ?? 1;
    if (desired <= 0) return;

    const sides = [
        { dir: "n", dx: 0, dz: -1 },
        { dir: "s", dx: 0, dz: 1 },
        { dir: "e", dx: 1, dz: 0 },
        { dir: "w", dx: -1, dz: 0 },
    ];

    // try sides in random order; skip any that fail the wall-continuity check
    const candidates = [...sides].sort(() => Math.random() - 0.5);
    let placed = 0;

    const layerCount = plan.wallLayers.length;

    for (const side of candidates) {
        if (placed >= desired) break;

        // ----- outermost layer position (used for the continuity check) -----
        const outerDiam = plan.size.diameter;
        let outerHX, outerHZ;
        if (plan.shape.key === "rectangle") {
            outerHX = Math.floor(plan.size.diameter / 2);
            outerHZ = Math.floor(rectangleDepth(plan.size.diameter) / 2);
        } else {
            const h = Math.floor(outerDiam / 2);
            outerHX = h;
            outerHZ = h;
        }
        const ox = int(plan.center.x + side.dx * outerHX);
        const oz = int(plan.center.z + side.dz * outerHZ);

        // ----- shared gate base Y (taken from innermost layer, same as before) -----
        const innerIdx = layerCount - 1;
        const innerDiam = plan.size.diameter - innerIdx * WALL_LAYER_SPACING * 2;
        let innerHX, innerHZ;
        if (plan.shape.key === "rectangle") {
            const shrink = innerIdx * WALL_LAYER_SPACING;
            innerHX = Math.floor(plan.size.diameter / 2) - shrink;
            innerHZ = Math.floor(rectangleDepth(plan.size.diameter) / 2) - shrink;
        } else {
            const h = Math.floor(innerDiam / 2);
            innerHX = h;
            innerHZ = h;
        }
        const innerX = int(plan.center.x + side.dx * innerHX);
        const innerZ = int(plan.center.z + side.dz * innerHZ);

        const top = getGroundY(dimension, innerX, innerZ, plan.center.y);
        let gateBaseY = top.ok
            ? top.y - (plan.size.wallHeight - 1)
            : platformY;
        gateBaseY = Math.max(platformY, gateBaseY);
        gateBaseY = clampY(gateBaseY + 1);

        const checkY = clampY(gateBaseY + 1);   // one block above the gate base

        // ----- continuity check: 1 block left + 1 block right of the 4-wide gate -----
        // must both be WALL_BLOCK at checkY
        let leftX, leftZ, rightX, rightZ;
        if (side.dir === "n" || side.dir === "s") {
            // wall runs along X
            const half = Math.floor(GATE_WIDTH / 2);          // 2
            leftX = ox - half - 1;
            rightX = ox + (GATE_WIDTH - half);               // ox + 2
            leftZ = rightZ = oz;
        } else {
            // wall runs along Z
            const half = Math.floor(GATE_WIDTH / 2);
            leftZ = oz - half - 1;
            rightZ = oz + (GATE_WIDTH - half);
            leftX = rightX = ox;
        }

        const leftType = getBlockTypeSafe(dimension, leftX, checkY, leftZ);
        const rightType = getBlockTypeSafe(dimension, rightX, checkY, rightZ);

        if (leftType !== WALL_BLOCK || rightType !== WALL_BLOCK) {
            // not a clean wall segment → try next side
            continue;
        }

        // ----- all good → place the gate on every wall layer -----
        const rotation = (side.dir === "e" || side.dir === "w")
            ? "90_degrees"
            : "0_degrees";

        for (let li = 0; li < layerCount; li++) {
            const diam = plan.size.diameter - li * WALL_LAYER_SPACING * 2;
            if (diam < 5) continue;

            let hx, hz;
            if (plan.shape.key === "rectangle") {
                const shrink = li * WALL_LAYER_SPACING;
                hx = Math.floor(plan.size.diameter / 2) - shrink;
                hz = Math.floor(rectangleDepth(plan.size.diameter) / 2) - shrink;
            } else {
                const h = Math.floor(diam / 2);
                hx = h;
                hz = h;
            }

            const px = int(plan.center.x + side.dx * hx);
            const pz = int(plan.center.z + side.dz * hz);

            const { fw, fd } = getRotatedFootprint(GATE_WIDTH, GATE_DEPTH, rotation);
            const placeX = px - Math.floor(fw / 2);
            const placeZ = pz - Math.floor(fd / 2);

            dimension.runCommand(
                `structure load ${GATE_STRUCTURE_ID} ${placeX} ${gateBaseY} ${placeZ} ${rotation} none`
            );
            await budgetYield();
        }

        placed++;
    }
}

export async function placeTowers(dimension, plan, foundationBlock, platformY, activePools, poolQueues) {
    const allTowers = activePools?.small_tower ?? [];
    if (allTowers.length === 0) return { placed: 0, skipped: 0 };

    const cx = plan.center.x;
    const cz = plan.center.z;
    const spacing = plan.size.towerSpacing;
    const points = plan.wallPoints;

    let placed = 0, skipped = 0;

    // Collect all wall points where a tower would be placed
    const towerCandidateIndices = [];
    {
        let accumCheck = 0;
        let lastPCheck = null;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (lastPCheck !== null) accumCheck += dist2D(p.x, p.z, lastPCheck.x, lastPCheck.z);
            lastPCheck = p;
            if (i !== 0 && accumCheck < spacing) continue;
            accumCheck = 0;
            towerCandidateIndices.push(i);
        }
    }

    // How many unique small tower variants to rotate around the wall
    const variantCount = (plan.size.key === "huge" || plan.size.key === "very_big") ? 3 : 2;

    // Pick that many unique small towers from the queue
    const selectedVariants = [];
    for (let i = 0; i < variantCount; i++) {
        const picked = drawFromQueue(poolQueues, "small_tower");
        if (!picked) break;
        selectedVariants.push(picked);
    }

    if (selectedVariants.length === 0) {
        return { placed: 0, skipped: 0 };
    }

    // Determine the first tower's wall-point position for wrap-around check
    const firstCandidatePoint = towerCandidateIndices.length > 0
        ? points[towerCandidateIndices[0]]
        : null;

    for (let ci = 0; ci < towerCandidateIndices.length; ci++) {
        const i = towerCandidateIndices[ci];
        const p = points[i];

        // Skip the last candidate if it's too close to the first (wrap-around)
        if (ci === towerCandidateIndices.length - 1 && ci > 0 && firstCandidatePoint) {
            const distToFirst = dist2D(p.x, p.z, firstCandidatePoint.x, firstCandidatePoint.z);
            if (distToFirst < spacing) {
                skipped++;
                continue;
            }
        }

        // Cycle through the selected variants in an alternating pattern
        const towerPicked = selectedVariants[ci % selectedVariants.length];

        const rotation = rotationTowardCampCenter(p.x, p.z, cx, cz, towerPicked.face);
        const { fw, fd } = getRotatedFootprint(towerPicked.width, towerPicked.depth, rotation);
        const halfOutset = Math.ceil(Math.max(fw, fd) / 2) + WALL_TOWER_OUTSET;

        const { nx, nz } = getWallOutwardNormal(p.x, p.z, cx, cz, plan);
        const ox = Math.round(nx * halfOutset);
        const oz = Math.round(nz * halfOutset);
        const tx = p.x + ox;
        const tz = p.z + oz;

        // Tower Y: use ground height, but clamp based on water presence.
        let top = getGroundY(dimension, tx, tz, plan.center.y);
        if (!top.ok) { skipped++; continue; }

        const towerGroundIsWater = isLiquidType(top.typeId);
        let y;
        if (towerGroundIsWater) {
            y = Math.max(platformY, top.y);
        } else {
            const minTowerY = platformY - TOWER_NEGATIVE_Y_ALLOWANCE;
            y = top.y >= minTowerY ? top.y : platformY;
        }

        await placeStructureFromPool(dimension, "small_tower", tx, y, tz, rotation, activePools, towerPicked);

        await placeSupportPlatform(dimension, tx, y + 1, tz, fw, fd, foundationBlock, platformY);

        // Fill the small gap between the tower's inner edge and the wall point
        const innerEdgeX = tx - Math.round(nx * Math.floor(fw / 2));
        const innerEdgeZ = tz - Math.round(nz * Math.floor(fd / 2));

        if (y === platformY) {
            const gapTypeId = getBlockTypeSafe(dimension, innerEdgeX, y, innerEdgeZ);
            if (isAirType(gapTypeId) || isLiquidType(gapTypeId)) {
                const gapMinX = Math.min(innerEdgeX, p.x) - 1;
                const gapMaxX = Math.max(innerEdgeX, p.x) + 1;
                const gapMinZ = Math.min(innerEdgeZ, p.z) - 1;
                const gapMaxZ = Math.max(innerEdgeZ, p.z) + 1;
                dimension.runCommand(
                    `fill ${gapMinX} ${clampY(y)} ${gapMinZ} ${gapMaxX} ${clampY(y)} ${gapMaxZ} ${INTERIOR_PLATFORM_BLOCK}`
                );
                await budgetYield();
            }
        }

        placed++;
        await nextTick();
    }

    return { placed, skipped };
}

export async function placeStructures(dimension, plan, activePools, poolQueues, platformY) {
    let placed = 0;
    let skipped = 0;

    for (const spot of plan.validStructureSpots) {
        if (!activePools[spot.pool] || activePools[spot.pool].length === 0) {
            skipped++;
            continue;
        }

        const picked = spot.picked ?? drawFromQueue(poolQueues, spot.pool);
        if (!picked) { skipped++; continue; }

        const rotation = spot.rotation ?? rotationTowardCampCenter(
            spot.x,
            spot.z,
            plan.center.x,
            plan.center.z,
            picked.face
        );

        const { fw, fd } = (spot.fw && spot.fd)
            ? { fw: spot.fw, fd: spot.fd }
            : getRotatedFootprint(picked.width, picked.depth, rotation);

        // Sample Y at the midpoint of the front-facing edge so the entrance
        // is accessible. The front faces toward the camp center, so we offset
        // half the depth in the direction TOWARD the center (inward).
        const dx = plan.center.x - spot.x;
        const dz = plan.center.z - spot.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        const frontOffsetX = len === 0 ? 0 : Math.round((dx / len) * Math.floor(fd / 2));
        const frontOffsetZ = len === 0 ? 0 : Math.round((dz / len) * Math.floor(fd / 2));
        const sampleX = spot.x + frontOffsetX;
        const sampleZ = spot.z + frontOffsetZ;

        // Don't scan from world height. Walk from the camp's allowed top
        // (center + MAX_STRUCTURE_Y_DELTA) down to the interior platform.
        const scanTop = clampY(plan.center.y + MAX_STRUCTURE_Y_DELTA);
        const scanBottom = platformY;
        let surfaceY = null;

        for (let y = scanTop; y >= scanBottom; y--) {
            const block = getBlockSafe(dimension, sampleX, y, sampleZ);

            if (!block) continue;
            if (block.isLiquidBlocking("Water") === false) continue;

            surfaceY = y;
            break;
        }

        if (surfaceY === null) {
            skipped++;
            continue;
        }

        const placeY = surfaceY - 1;
        const structureBaseY = placeY + 1;
        const cornerSupport = structureCornersHaveSupport(
            dimension,
            spot.x,
            structureBaseY,
            spot.z,
            fw,
            fd
        );

        if (!cornerSupport.ok) {
            skipped++;
            continue;
        }

        await fillAroundStructure(dimension, spot.x, placeY + 1, spot.z, fw, fd);

        const result = await placeStructureFromPool(
            dimension, spot.pool, spot.x, placeY, spot.z, rotation, activePools, picked
        );

        if (result.placed) placed++;
        else skipped++;

        await placeSupportPlatform(
            dimension,
            spot.x, placeY + 1, spot.z,
            fw, fd,
            INTERIOR_PLATFORM_BLOCK,
            platformY
        );

        await nextTick();
    }

    return { placed, skipped };
}