import {
    DEFOREST_PAD,
    TOWER_MAX_FOOTPRINT,
    MAX_STRUCTURE_Y_DELTA,
} from "../../config/camp/configCamp.js";
import {
    clampY,
    budgetYield,
} from "./smallHelpers.js";
import {
    getPlanHalfExtents,
} from "./geometry.js";


const DEFOREST_LOGS = [
    "minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log",
    "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
    "minecraft:mangrove_log", "minecraft:cherry_log", "minecraft:pale_oak_log"
];

const DEFOREST_LEAVES = [
    "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves",
    "minecraft:jungle_leaves", "minecraft:acacia_leaves", "minecraft:dark_oak_leaves",
    "minecraft:mangrove_leaves", "minecraft:cherry_leaves", "minecraft:pale_oak_leaves",
    "minecraft:azalea_leaves", "minecraft:azalea_leaves_flowered"
];

const DEFOREST_MISC = [
    "minecraft:red_mushroom_block", "minecraft:brown_mushroom_block", "minecraft:mushroom_stem", "minecraft:tall_grass", "minecraft:large_fern", "minecraft:fern",
    "minecraft:reeds", "minecraft:bamboo", "minecraft:vine", "minecraft:mangrove_roots"
];

const DEFOREST_CHUNK_XZ = 48; // chunk size per fillBlocks call
const DEFOREST_CHUNK_Y = 14; // 48*48*14 = 32256, safely under /fill limit

export async function deforestArea(dimension, minX, minY, minZ, maxX, maxY, maxZ) {
    const allBlocks = [...DEFOREST_LEAVES, ...DEFOREST_LOGS, ...DEFOREST_MISC];

    const y1 = clampY(Math.min(minY, maxY));
    const y2 = clampY(Math.max(minY, maxY));

    const xs = [];
    const ys = [];
    const zs = [];

    for (let x = minX; x <= maxX; x += DEFOREST_CHUNK_XZ) xs.push(x);
    for (let y = y1; y <= y2; y += DEFOREST_CHUNK_Y) ys.push(y);
    for (let z = minZ; z <= maxZ; z += DEFOREST_CHUNK_XZ) zs.push(z);

    for (const cx of xs) {
        for (const cy of ys) {
            for (const cz of zs) {

                const x2 = Math.min(cx + DEFOREST_CHUNK_XZ - 1, maxX);
                const y2s = Math.min(cy + DEFOREST_CHUNK_Y - 1, y2);
                const z2 = Math.min(cz + DEFOREST_CHUNK_XZ - 1, maxZ);

                for (const blockId of allBlocks) {
                    try {
                        dimension.runCommand(
                            `fill ${cx} ${cy} ${cz} ${x2} ${y2s} ${z2} minecraft:air replace ${blockId}`
                        );
                    } catch (e) {
                        console.warn(
                            `[deforest] fill failed box=(${cx},${cy},${cz})->(${x2},${y2s},${z2}) block=${blockId} err=${e}`
                        );
                    }
                    await budgetYield();
                }
            }
        }
    }
}

export async function deforestAreaCircle(dimension, cx, cz, radius, minY, maxY) {
    const allBlocks = [...DEFOREST_LEAVES, ...DEFOREST_LOGS, ...DEFOREST_MISC];

    const y1 = clampY(Math.min(minY, maxY));
    const y2 = clampY(Math.max(minY, maxY));

    const ys = [];
    for (let y = y1; y <= y2; y += DEFOREST_CHUNK_Y) ys.push(y);

    for (let dz = -radius; dz <= radius; dz++) {
        const chordR = Math.floor(Math.sqrt(Math.max(0, radius * radius - dz * dz)));
        const z = cz + dz;
        const xMin = cx - chordR;
        const xMax = cx + chordR;

        for (const cy of ys) {
            const y2s = Math.min(cy + DEFOREST_CHUNK_Y - 1, y2);

            for (const blockId of allBlocks) {
                try {
                    dimension.runCommand(
                        `fill ${xMin} ${cy} ${z} ${xMax} ${y2s} ${z} minecraft:air replace ${blockId}`
                    );
                } catch (e) {
                    console.warn(
                        `[deforest] circle row failed z=${z} y=${cy}-${y2s} block=${blockId} err=${e}`
                    );
                }
                await budgetYield();
            }
        }
    }
}

export async function deforestAreaForPlan(dimension, plan, centerX, centerY, centerZ) {
    const pad = TOWER_MAX_FOOTPRINT + DEFOREST_PAD;
    const minY = centerY - MAX_STRUCTURE_Y_DELTA - 10;
    const maxY = centerY + 70;

    if (plan.shape.key === "circle") {
        const radius = Math.floor(plan.size.diameter / 2) + pad;
        await deforestAreaCircle(dimension, centerX, centerZ, radius, minY, maxY);
        return;
    }

    // square / rectangle — use the plan's real half-extents (rectangle is
    // shallower in Z than it is wide in X, so this no longer over-clears it
    // into a square).
    const { halfW, halfD } = getPlanHalfExtents(plan, pad);

    await deforestArea(
        dimension,
        centerX - halfW, minY, centerZ - halfD,
        centerX + halfW, maxY, centerZ + halfD
    );
}