import { world } from "@minecraft/server";

// =========================
// INVENTORY HELPERS
// =========================

export function hasItem(player, itemId, amount = 1) {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    let total = 0;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && item.typeId === itemId) {
            total += item.amount;
            if (total >= amount) return true;
        }
    }
    return false;
}

export function removeItem(player, itemId, amount = 1) {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    let total = 0;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && item.typeId === itemId) total += item.amount;
    }
    if (total < amount) return false;

    let remaining = amount;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (!item || item.typeId !== itemId) continue;

        if (item.amount <= remaining) {
            remaining -= item.amount;
            inv.setItem(i, undefined);
        } else {
            item.amount -= remaining;
            inv.setItem(i, item);
            remaining = 0;
        }
        if (remaining <= 0) break;
    }
    return true;
}

/** Removes exactly 1 of the given item from the player's inventory */
export function removeOneItem(player, typeId) {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return;

    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && item.typeId === typeId) {
            if (item.amount > 1) {
                item.amount -= 1;
                inv.setItem(i, item);
            } else {
                inv.setItem(i, undefined);
            }
            return;
        }
    }
}

// =========================
// TAG SYSTEM
// =========================

export function setTag(entity, prefix, value) {
    for (const tag of entity.getTags()) {
        if (tag.startsWith(prefix)) {
            entity.removeTag(tag);
        }
    }
    entity.addTag(`${prefix}${value}`);
}

export function getTag(entity, prefix, fallback) {
    const tag = entity.getTags().find(t => t.startsWith(prefix));
    if (!tag) return fallback;
    return tag.split(":")[1];
}

// =========================
// LOCATION / BLOCK HELPERS
// =========================

export function blockCenter(block) {
    return {
        x: block.location.x + 0.5,
        y: block.location.y + 0.5,
        z: block.location.z + 0.5
    };
}

/**
 * Returns the Y-offset storage position for a spawner entity.
 * Overworld / Nether / End aware.
 */
export function getStorageLocation(block) {
    const center = blockCenter(block);
    const dimId = block.dimension?.id ?? "minecraft:overworld";

    let offsetY;

    if (dimId === "minecraft:nether") {
        if (center.y < 60) {
            offsetY = Math.min(center.y + 40, 115);
        } else {
            offsetY = Math.max(center.y - 40, 10);
        }
    } else if (dimId === "minecraft:the_end") {
        offsetY = center.y > 80 ? center.y - 60 : center.y + 60;
        offsetY = Math.max(10, Math.min(offsetY, 240));
    } else {
        const STORAGE_Y_MIDPOINT = 128;
        const STORAGE_Y_OFFSET = 192;
        offsetY = center.y > STORAGE_Y_MIDPOINT
            ? center.y - STORAGE_Y_OFFSET
            : center.y + STORAGE_Y_OFFSET;
    }

    return { x: center.x, y: offsetY, z: center.z };
}

// =========================
// MISC HELPERS
// =========================

export function stripColors(text) {
    return text.replace(/§./g, "");
}

export function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

export function canUpgrade(current, next, tiers) {
    const currentIndex = tiers.indexOf(current); // -1 for "None"
    const nextIndex = tiers.indexOf(next);
    return nextIndex > currentIndex;
}

export function getAllDimensions() {
    return [
        world.getDimension("overworld"),
        world.getDimension("nether"),
        world.getDimension("the_end")
    ];
}

// =========================
// TROOP HELPERS
// =========================

export function isBarbarian(typeId) {
    return typeof typeId === "string" && typeId.startsWith("subo:barbarian_");
}

export function isArcher(typeId) {
    return typeof typeId === "string" && typeId.startsWith("subo:archer_");
}

export function isDragon(typeId) {
    return typeof typeId === "string" && typeId.startsWith("subo:dragon_");
}

export function isTroop(typeId) {
    return isBarbarian(typeId) || isArcher(typeId) || isDragon(typeId);
}