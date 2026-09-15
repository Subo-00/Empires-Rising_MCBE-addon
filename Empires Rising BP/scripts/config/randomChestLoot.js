// ---- 1. Loot pools per tier ----
// weight = relative chance, min/max = stack size range
export const LOOT_TIERS = {
    // Tier 1 - BASIC
    "subo:random_chest_1": {
        rolls: 5,
        pool: [
            { id: "minecraft:bread", weight: 6, min: 1, max: 6 },
            { id: "minecraft:arrow", weight: 5, min: 4, max: 16 },
            { id: "minecraft:iron_ingot", weight: 5, min: 1, max: 4 },
            { id: "minecraft:copper_ingot", weight: 5, min: 1, max: 4 },
            { id: "minecraft:coal", weight: 6, min: 2, max: 8 },
            { id: "minecraft:apple", weight: 4, min: 1, max: 4 },
            { id: "minecraft:leather", weight: 3, min: 1, max: 3 },
            { id: "minecraft:gold_ingot", weight: 2, min: 1, max: 3 },
            { id: "minecraft:golden_apple", weight: 1, min: 1, max: 2 },
            { id: "minecraft:diamond", weight: 1, min: 1, max: 1 },
            { id: "minecraft:emerald", weight: 1, min: 1, max: 2 },
            { id: "minecraft:book", weight: 1, min: 6, max: 16 },
            { id: "minecraft:gunpowder", weight: 1, min: 2, max: 5 },
            { id: "minecraft:fire_charge", weight: 1, min: 1, max: 4 },
        ],
    },
    // Tier 2 - RARE
    "subo:random_chest_2": {
        rolls: 6,
        pool: [
            { id: "minecraft:iron_ingot", weight: 20, min: 5, max: 13 },
            { id: "minecraft:gold_ingot", weight: 10, min: 3, max: 9 },
            { id: "minecraft:emerald", weight: 6, min: 1, max: 5 },
            { id: "minecraft:diamond", weight: 5, min: 1, max: 3 },
            { id: "minecraft:experience_bottle", weight: 3, min: 10, max: 32 },
            { id: "minecraft:netherite_scrap", weight: 3, min: 1, max: 2 },
            { id: "minecraft:golden_apple", weight: 2, min: 1, max: 2 },
            { id: "minecraft:ender_pearl", weight: 2, min: 1, max: 3 },
            { id: "minecraft:name_tag", weight: 1, min: 1, max: 1 },
            { id: "minecraft:gunpowder", weight: 1, min: 6, max: 16 },
            { id: "minecraft:slime_ball", weight: 1, min: 3, max: 12 },
            { id: "minecraft:phantom_membrane", weight: 1, min: 1, max: 2 },
            { id: "minecraft:vex_armor_trim_smithing_template", weight: 1, min: 1, max: 1 },
            { id: "subo:rift_fragment", weight: 1, min: 1, max: 1 },
            { id: "subo:rift_fragment", weight: 1, min: 1, max: 1 },
            { id: "subo:rift_core", weight: 1, min: 1, max: 1 },
        ],
    },
    // Tier 3 - EPIC
    "subo:random_chest_3": {
        rolls: 7,
        pool: [
            { id: "minecraft:diamond", weight: 10, min: 2, max: 6 },
            { id: "minecraft:emerald", weight: 10, min: 3, max: 9 },
            { id: "minecraft:netherite_scrap", weight: 3, min: 1, max: 3 },
            { id: "minecraft:netherite_ingot", weight: 2, min: 1, max: 1 },
            { id: "minecraft:enchanted_golden_apple", weight: 2, min: 1, max: 2 },
            { id: "minecraft:experience_bottle", weight: 2, min: 24, max: 64 },
            { id: "minecraft:netherite_upgrade_smithing_template", weight: 2, min: 1, max: 2 },
            { id: "minecraft:totem_of_undying", weight: 2, min: 1, max: 1 },
            { id: "subo:rift_fragment", weight: 2, min: 1, max: 1 },
            { id: "subo:rift_core", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_sword", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_helmet", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_chestplate", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_leggings", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_boots", weight: 1, min: 1, max: 1 },
            { id: "minecraft:shulker_shell", weight: 1, min: 1, max: 2 },
        ],
    },
};