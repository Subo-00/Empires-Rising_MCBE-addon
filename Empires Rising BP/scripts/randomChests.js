import { BlockPermutation, ItemStack } from "@minecraft/server";

// ---- 1. Loot pools per tier ----
// weight = relative chance, min/max = stack size range
const LOOT_TIERS = {
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
            { id: "minecraft:iron_ingot", weight: 20, min: 2, max: 6 },
            { id: "minecraft:gold_ingot", weight: 10, min: 2, max: 6 },
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
            { id: "minecraft:diamond_sword", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_helmet", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_chestplate", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_leggings", weight: 1, min: 1, max: 1 },
            { id: "minecraft:diamond_boots", weight: 1, min: 1, max: 1 },
            { id: "minecraft:shulker_shell", weight: 1, min: 1, max: 2 },
        ],
    },
};

// Fallback if an unknown block id is passed
const DEFAULT_TIER = LOOT_TIERS["subo:random_chest_1"];

// ---- 2. Small helpers ----
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickWeighted(pool) {
    const total = pool.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * total;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll < 0) return entry;
    }
    return pool[pool.length - 1];
}

function makeItemFromEntry(entry) {
    const amount = randInt(entry.min, entry.max);
    return new ItemStack(entry.id, amount);
}

// ---- 3. Fill a container with N random rolls ----
function fillContainerRandom(container, rolls, pool) {
    const size = container.size; // chest = 27 slots
    const usedSlots = new Set();

    for (let i = 0; i < rolls; i++) {
        const entry = pickWeighted(pool);
        const item = makeItemFromEntry(entry);

        // find a random empty slot (stop trying if chest is full)
        let slot;
        do {
            slot = randInt(0, size - 1);
        } while (usedSlots.has(slot) && usedSlots.size < size);

        if (usedSlots.size >= size) break;

        usedSlots.add(slot);
        container.setItem(slot, item);
    }
}

// ---- 4. Main function: replace block with a filled chest ----
// Tier is auto-detected from the block's typeId before we overwrite it.
export function replaceWithLootChest(block) {
    const tier = LOOT_TIERS[block.typeId] ?? DEFAULT_TIER;

    // Read the facing captured at placement (before we overwrite the block)
    let facing = "north";
    try {
        facing = block.permutation.getState("minecraft:cardinal_direction") ?? "north";
        
    } catch (e) {/* state missing -> default */
    }

    const OPPOSITE = { north: "south", south: "north", east: "west", west: "east" };
    facing = OPPOSITE[facing] ?? facing;


    // Place a chest facing the same direction
    block.setPermutation(
        BlockPermutation.resolve("minecraft:chest", {
            "minecraft:cardinal_direction": facing,
        })
    );

    const inventory = block.getComponent("minecraft:inventory");
    if (!inventory) return;

    const container = inventory.container;
    if (!container) return;

    fillContainerRandom(container, tier.rolls, tier.pool);
}