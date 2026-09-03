import {
    DEFAULT_SUPPORT_BLOCK,
    FOUNDATION_PILLAR_BLOCK,
} from "../../config/camp/configCamp.js";
import {
    clampY,
    budgetYield,
    placePillarDown,
} from "./helpers.js";


// Fills only the 4 vertical side-faces of a box (not the solid interior),
// without ever re-filling the same corner cell twice:
//   - North/South rows span the FULL X width (they "own" the 4 corners).
//   - West/East columns only span the INTERIOR Z range (minZ+1..maxZ-1),
//     so they never re-touch the corners already placed by North/South.
export async function fillAreaSidesOnly(dimension, minX, minY, minZ, maxX, maxY, maxZ, blockType, replaceTarget = null) {
    const suffix = replaceTarget ? ` replace ${replaceTarget}` : "";
    const y1 = clampY(minY), y2 = clampY(maxY);

    // North face (full width, includes both NW/NE corners)
    dimension.runCommand(`fill ${minX} ${y1} ${minZ} ${maxX} ${y2} ${minZ} ${blockType}${suffix}`);
    await budgetYield();

    // South face (full width, includes both SW/SE corners) — skip if it's the same row as North
    if (maxZ !== minZ) {
        dimension.runCommand(`fill ${minX} ${y1} ${maxZ} ${maxX} ${y2} ${maxZ} ${blockType}${suffix}`);
        await budgetYield();
    }

    // West/East faces — only the interior Z range, corners already done above
    if (maxZ - minZ >= 2) {
        dimension.runCommand(`fill ${minX} ${y1} ${minZ + 1} ${minX} ${y2} ${maxZ - 1} ${blockType}${suffix}`);
        await budgetYield();

        if (maxX !== minX) {
            dimension.runCommand(`fill ${maxX} ${y1} ${minZ + 1} ${maxX} ${y2} ${maxZ - 1} ${blockType}${suffix}`);
            await budgetYield();
        }
    }
}

/**
 * Places a support platform centered at (cx, topY, cz).
 * Top layer: full sizeX × sizeZ rectangle (exact structure footprint, replace-only).
 * Corner pillars: 3 outer blocks per corner drilled straight down to solid ground
 * (the inner corner block is intentionally skipped — it's covered by the
 * DEFAULT_SUPPORT_BLOCK fill below instead).
 * Support fill: DEFAULT_SUPPORT_BLOCK filling the area 1 block smaller (on every
 * side) than the platform, going down to the interior platform's Y level or
 * 2 blocks under the lowest corner pillar — whichever is higher up.
 */
export async function placeSupportPlatform(dimension, cx, topY, cz, sizeX, sizeZ, blockType, platformY) {
    
    const minX = cx - Math.floor(sizeX / 2);
    const maxX = minX + sizeX - 1;
    const minZ = cz - Math.floor(sizeZ / 2);
    const maxZ = minZ + sizeZ - 1;

    // Top layer — exact structure footprint, only fills air gaps and marker blocks
    for (const replaceBlock of ["minecraft:air", "minecraft:emerald_block"]) {
        dimension.runCommand(
            `fill ${minX} ${clampY(topY)} ${minZ} ${maxX} ${clampY(topY)} ${maxZ} ${blockType} replace ${replaceBlock}`
        );
        await budgetYield();
    }

    // Corner pillars drill downward through air/liquid to the first solid block
    // (3 outer blocks per corner only — see comment on placeFoundationPillars)
    const lowestPillarY = await placeFoundationPillars(dimension, minX, maxX, minZ, maxZ, topY);

    // Support fill: inset by 1 block on every side, stopping at whichever
    // boundary is higher up — the interior platform level, or 2 blocks under
    // the lowest corner pillar.
    const insetMinX = minX + 1, insetMaxX = maxX - 1;
    const insetMinZ = minZ + 1, insetMaxZ = maxZ - 1;
    const fillTop = topY - 1;
    const fillBottom = Math.max(platformY, lowestPillarY - 2);

    // Only needed when the ground isn't flat — if every corner pillar stopped
    // right at topY, the terrain is level and there's nothing to fill in.
    const groundIsUneven = lowestPillarY < topY;

    if (groundIsUneven && insetMaxX >= insetMinX && insetMaxZ >= insetMinZ && fillTop >= fillBottom) {
        await fillAreaSidesOnly(
            dimension,
            insetMinX, fillBottom, insetMinZ,
            insetMaxX, fillTop, insetMaxZ,
            DEFAULT_SUPPORT_BLOCK
        );
    }
}

// Drills 3 of the 4 blocks at each corner of the footprint straight down to
// solid ground (skips the innermost diagonal block — that position is
// already covered by the DEFAULT_SUPPORT_BLOCK inset fill in
// placeSupportPlatform, so a separate pillar there would be redundant).
// Returns the lowest Y any of the pillars had to reach.
export async function placeFoundationPillars(dimension, minX, maxX, minZ, maxZ, topY) {
    const corners = [
        { x: minX, z: minZ, dx: 1, dz: 1 },
        { x: maxX, z: minZ, dx: -1, dz: 1 },
        { x: minX, z: maxZ, dx: 1, dz: -1 },
        { x: maxX, z: maxZ, dx: -1, dz: -1 },
    ];

    let lowestY = topY;

    for (const corner of corners) {
        const y1 = await placePillarDown(dimension, corner.x, topY, corner.z, FOUNDATION_PILLAR_BLOCK);
        const y2 = await placePillarDown(dimension, corner.x + corner.dx, topY, corner.z, FOUNDATION_PILLAR_BLOCK);
        const y3 = await placePillarDown(dimension, corner.x, topY, corner.z + corner.dz, FOUNDATION_PILLAR_BLOCK);
        // corner.x + corner.dx, corner.z + corner.dz (the inner diagonal block) is
        // intentionally skipped here.
        lowestY = Math.min(lowestY, y1, y2, y3);
    }

    return lowestY;
}