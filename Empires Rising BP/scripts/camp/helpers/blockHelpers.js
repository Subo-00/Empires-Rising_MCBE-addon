import {
    int,
    clampY,
    budgetYield,
} from "./smallHelpers.js";


export function isAirType(typeId) {
    return (
        typeId === "minecraft:air" ||
        typeId === "minecraft:cave_air" ||
        typeId === "minecraft:void_air"
    );
}

export function isLiquidType(typeId) {
    return (
        typeId === "minecraft:water" ||
        typeId === "minecraft:lava" ||
        typeId === "minecraft:flowing_water" ||
        typeId === "minecraft:flowing_lava"
    );
}

export function isLogType(typeId) {
    return (
        typeId.includes("_log") ||
        typeId.includes("_wood") ||
        typeId.includes("_stem") ||
        typeId.includes("_hyphae")
    );
}

export function isLeavesType(typeId) {
    return typeId.includes("leaves") || typeId.includes("_leaf");
}

/**
 * Water/lava are intentionally NOT ignored.
 * Trees, leaves, grass, and flowers are ignored.
 */
export function shouldIgnoreForTerrainTop(block) {
    const typeId = block?.typeId ?? "minecraft:air";
    if (isAirType(typeId)) return true;
    if (isLeavesType(typeId)) return true;
    if (isLogType(typeId)) return true;
    // Liquids must STOP the scan — never ignore them.
    if (isLiquidType(typeId)) return false;
    // Any remaining non-liquid block that doesn't block liquid flow is
    // passable vegetation/decoration (grass, ferns, flowers, snow_layer…).
    if (block && !block.isLiquidBlocking("Water")) return true;
    return false;
}

export function getBlockSafe(dimension, x, y, z) {
    try {
        return dimension.getBlock({ x: int(x), y: clampY(y), z: int(z) });
    } catch {
        return null;
    }
}

export function getBlockTypeSafe(dimension, x, y, z) {
    try {
        const block = dimension.getBlock({ x: int(x), y: clampY(y), z: int(z) });
        return block?.typeId ?? "minecraft:air";
    } catch {
        return "minecraft:air";
    }
}

export async function setBlock(dimension, x, y, z, typeId) {
    dimension.runCommand(`setblock ${int(x)} ${clampY(y)} ${int(z)} ${typeId}`);
    await budgetYield();
}