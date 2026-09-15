import { BlockPermutation, ItemStack } from "@minecraft/server";
import { LOOT_TIERS } from "../config/randomChestLoot.js";


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