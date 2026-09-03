import { world, ItemStack } from "@minecraft/server";
import { DROP_TABLE } from "./config/specialMobDropTable.js"


const ITEM_IDS = {
    corrupted_soul: "subo:corrupted_soul",
    rotten_heart: "subo:rotten_heart"
};

function rollDrops(entity, multiplier = 1) {
    const typeId = entity.typeId;
    const table = DROP_TABLE[typeId] ?? DROP_TABLE["default"];
    const loc = entity.location;
    const dim = entity.dimension;

    for (const key in table) {
        const chance = table[key] * multiplier;   // 2× when player kill
        if (Math.random() < chance) {
            const itemId = ITEM_IDS[key];
            if (!itemId) continue;
            dim.spawnItem(new ItemStack(itemId, 1), loc);
        }
    }
}

world.afterEvents.entityDie.subscribe((ev) => {
    const dead = ev.deadEntity;
    const damager = ev.damageSource?.damagingEntity;

    // Only when killed by another entity
    if (!damager) return;

    const families = dead.getComponent("minecraft:type_family");
    if (!families || !families.hasTypeFamily("monster")) return;

    // 2× drop chance if the killer is a player
    const multiplier = damager.typeId === "minecraft:player" ? 2 : 0.8;

    rollDrops(dead, multiplier);
});