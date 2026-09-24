import {
    WALL_BLOCK,
    WALL_CAP_BLOCK,
} from "../../config/camp/configCamp.js";
import {
    int,
    now,
    clampY,
    budgetYield,
    nextTick,
} from "./smallHelpers.js";
import {
    placeSupportPlatform,
} from "./supportsPlatforms.js";
import {
    getGroundY,
} from "./planValidation.js";
import {
    isAirType,
    getBlockTypeSafe,
    setBlock,
} from "./blockHelpers.js";


export async function placeWallPillar(dimension, x, groundY, z, height, platformY) {
    const baseY = clampY(groundY);
    const topY = clampY(groundY + height - 1);

    // Fill gap downward to platform (air and water only)
    if (platformY < baseY) {
        for (const replaceBlock of ["minecraft:air", "minecraft:water", "minecraft:lava"]) {
            dimension.runCommand(
                `fill ${x} ${clampY(platformY)} ${z} ${x} ${clampY(baseY - 1)} ${z} ${WALL_BLOCK} replace ${replaceBlock}`
            );
        }
        await budgetYield();
    }

    // Fill the main pillar body (excluding cap)
    if (baseY < topY) {
        dimension.runCommand(`fill ${x} ${baseY} ${z} ${x} ${clampY(topY - 1)} ${z} ${WALL_BLOCK}`);
        await budgetYield();
    }

    // Place cap
    await setBlock(dimension, x, topY, z, WALL_CAP_BLOCK);
}

export async function fillGapUnderRaisedPillar(dimension, x, z, previousGroundY, currentGroundY) {
    if (previousGroundY === null || previousGroundY === undefined) return;
    if (currentGroundY <= previousGroundY + 2) return;

    const checkY = clampY(previousGroundY + 2);
    const typeId = getBlockTypeSafe(dimension, x, checkY, z);

    if (!isAirType(typeId)) return;

    for (let y = checkY; y < currentGroundY; y++) {
        await setBlock(dimension, x, y, z, WALL_BLOCK);
    }
}

export async function placeWalls(dimension, plan, foundationBlock, platformY, wallPoints = null) {
    const center = plan.center;

    const wall_height = plan.size.wallHeight;

    let previousGroundY = null;

    // console.warn(`[camp] WALL start pillars=${plan.wallPoints.length}`);

    // let totalLoadWaitMs = 0;
    // let totalPillarMs = 0;
    // let slowPillars = 0;

    const points = wallPoints ?? plan.wallPoints;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        // const pillarStart = now();

        const top = getGroundY(dimension, p.x, p.z, plan.center.y);

        if (!top.ok) {
            previousGroundY = null;
            continue;
        }

        let wallGroundY = top.y;

        if (top.y < platformY) {
            // console.warn(`[camp] WALL pillar #${i} needs bridge at (${p.x},${p.z}) groundY=${top.y} platformY=${platformY} !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);

            const bridgeStart = now();

            await placeSupportPlatform(
                dimension,
                p.x, platformY, p.z,
                plan.size.supportRadius * 2 + 1,
                plan.size.supportRadius * 2 + 1,
                foundationBlock,
                platformY
            );
            // console.warn(`[camp] WALL bridge done at (${p.x},${p.z}) took=${now() - bridgeStart}ms`);

            wallGroundY = platformY;
        }

        // Crevice/spike detection — compare top Y positions
        let adjustedHeight = wall_height;

        if (previousGroundY !== null) {
            // const currentTopY = wallGroundY + adjustedHeight - 1;
            const threshold = Math.floor(adjustedHeight * 0.5);
            const delta = wallGroundY - previousGroundY;

            if (delta <= -threshold) {
                // Sudden drop: we "fell into" a crevice.
                // Make this pillar's top match previousTopY - 1.
                adjustedHeight = Math.max(1, (previousGroundY + wall_height - 2) - wallGroundY + 1);
            } else if (delta >= threshold) {
                // Sudden spike: we "got out" of a crevice.
                // The previous pillar needs to be extended to currentTopY - 1.
                // We re-place just the cap portion of the previous pillar.
                const prevPoint = points[i - 1];
                if (prevPoint && previousGroundY !== null) {
                    if (wallGroundY > previousGroundY) {
                        const extendedTopY = wallGroundY + adjustedHeight - 2;
                        dimension.runCommand(
                            `fill ${int(prevPoint.x)} ${clampY(previousGroundY)} ${int(prevPoint.z)} ${int(prevPoint.x)} ${clampY(extendedTopY - 1)} ${int(prevPoint.z)} ${WALL_BLOCK}`
                        );
                        await setBlock(dimension, prevPoint.x, extendedTopY, prevPoint.z, WALL_CAP_BLOCK);
                        await budgetYield();
                    }
                }
            }
        }

        const loadStart = now();
        await fillGapUnderRaisedPillar(dimension, p.x, p.z, previousGroundY, wallGroundY);
        await placeWallPillar(dimension, p.x, wallGroundY, p.z, adjustedHeight, platformY);
        const loadMs = now() - loadStart;
        // totalLoadWaitMs += loadMs;

        previousGroundY = wallGroundY;
        // previousTopY = wallGroundY + adjustedHeight - 1;


        // const pillarMs = now() - pillarStart;
        // totalPillarMs += pillarMs;

        // if (pillarMs > 500) {
        // slowPillars++;
        // console.warn(`[camp] WALL slow pillar #${i} at (${p.x},${p.z}) pillar=${pillarMs}ms load=${loadMs}ms`);
        // }

        if (i % 40 === 0) {
            // console.warn(
            //     `[camp] WALL progress ${i}/${plan.points.length} ` +
            //     `avgPillar=${Math.round(totalPillarMs / Math.max(1, i + 1))}ms ` +
            //     `totalLoad=${totalLoadWaitMs}ms slowPillars=${slowPillars}`
            // );
            await nextTick();
        }
    }

    // console.warn(
    //     `[camp] WALL done pillars=${plan.wallPoints.length} ` +
    //     `totalLoad=${totalLoadWaitMs}ms totalPillar=${totalPillarMs}ms slowPillars=${slowPillars}`
    // );

    // console.warn("[camp] WALL done");
}