import {
    INTERIOR_PLATFORM_BLOCK,
    FOUNDATION_PILLAR_BLOCK,
    INTERIOR_PILLAR_SPACING,
} from "../../config/camp/configCamp.js";
import {
    clampY,
    key2,
    placePillarDown,
} from "./smallHelpers.js";
import {
    getPlanHalfExtents,
} from "./geometry.js";


export async function placeInteriorPlatform(dimension, plan, platformY) {
    const cx = plan.center.x;
    const cz = plan.center.z;
    platformY = clampY(platformY);

    const { r, halfW, halfD } = getPlanHalfExtents(plan, 1);
    const isCircle = plan.shape.key === "circle";

    if (!isCircle) {

        const FILL_CHUNK = 100; // safe chunk size (100*100 = 10,000 blocks per fill)

        for (let fx = cx - halfW; fx <= cx + halfW; fx += FILL_CHUNK) {
            for (let fz = cz - halfD; fz <= cz + halfD; fz += FILL_CHUNK) {
                const x1 = fx;
                const x2 = Math.min(fx + FILL_CHUNK - 1, cx + halfW);
                const z1 = fz;
                const z2 = Math.min(fz + FILL_CHUNK - 1, cz + halfD);
                dimension.runCommand(
                    `fill ${x1} ${platformY} ${z1} ${x2} ${platformY} ${z2} ${INTERIOR_PLATFORM_BLOCK}`
                );
            }
        }
        return;
    }

    // Circle: fill row by row using chord width at each Z offset
    const rPad = r + 2;
    for (let dz = -rPad; dz <= rPad; dz++) {
        const chordR = Math.floor(Math.sqrt(rPad * rPad - dz * dz));
        if (chordR < 0) continue;
        const z = cz + dz;
        dimension.runCommand(
            `fill ${cx - chordR} ${platformY} ${z} ${cx + chordR} ${platformY} ${z} ${INTERIOR_PLATFORM_BLOCK}`
        );
    }
}

export async function placeInteriorPlatformPillars(dimension, plan, platformY) {
    const cx = plan.center.x;
    const cz = plan.center.z;
    platformY = clampY(platformY);

    const { r, halfW, halfD } = getPlanHalfExtents(plan, -1);

    const seen = new Set();
    const tryPillar = async (x, z) => {
        const k = key2(x, z);
        if (seen.has(k)) return;
        seen.add(k);
        await placePillarDown(dimension, x, platformY, z, FOUNDATION_PILLAR_BLOCK);
    };

    if (plan.shape.key === "circle") {
        // Pillars spaced ~every 10 blocks around the platform edge.
        const rPad = r;
        const circumference = 2 * Math.PI * rPad;
        const count = Math.max(4, Math.round(circumference / INTERIOR_PILLAR_SPACING));
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const x = Math.round(cx + Math.cos(a) * rPad);
            const z = Math.round(cz + Math.sin(a) * rPad);
            await tryPillar(x, z);
        }
        return;
    }

    // Square / rectangle: match the exact platform extents used in placeInteriorPlatform
    const minX = cx - halfW, maxX = cx + halfW;
    const minZ = cz - halfD, maxZ = cz + halfD;

    // North & south edges (every 10 blocks + guaranteed end corners)
    for (let x = minX; x <= maxX; x += INTERIOR_PILLAR_SPACING) {
        await tryPillar(x, minZ);
        await tryPillar(x, maxZ);
    }
    await tryPillar(maxX, minZ);
    await tryPillar(maxX, maxZ);

    // West & east edges (every 10 blocks + guaranteed end corners)
    for (let z = minZ; z <= maxZ; z += INTERIOR_PILLAR_SPACING) {
        await tryPillar(minX, z);
        await tryPillar(maxX, z);
    }
    await tryPillar(minX, maxZ);
}