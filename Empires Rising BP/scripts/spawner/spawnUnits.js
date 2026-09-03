import { world, system } from "@minecraft/server";
import { DRAGON_HP_PER_LEVEL, FACTION_MAP } from "../config/spawnerConfig.js"; 
import { getTag, getStorageLocation } from "./spawnerHelpers.js";
import { getPlayerFaction } from "./faction.js";


export function spawnUnit(spawner) {
    const dim = spawner.dimension;
    const spawnerType = getTag(spawner, "type:");
    const ownerName = getTag(spawner, "owner:", "");

    // Get owner's faction
    const player = [...world.getPlayers()].find(p => p.name === ownerName);
    let factionId = 0;
    if (player) factionId = getPlayerFaction(player);

    // Fallback: if owner offline / no score, default to fire or refuse
    if (factionId === 0) {
        // Optional: kill the queued unit or just skip
        return null;
    }

    const faction = FACTION_MAP[factionId];

    let entityType = `subo:barbarian_${faction}`;
    let eventName = "barbarian:follow";

    if (spawnerType === "archer") {
        entityType = `subo:archer_${faction}`;
        eventName = "archer:follow";
    }
    if (spawnerType === "dragon") {
        entityType = `subo:dragon_${faction}`;
        eventName = "dragon:follow";
    }

    const spawn_pos = getStorageLocation(spawner)
    spawn_pos.x -= 0.5;
    spawn_pos.z -= 0.5;

    const unit = dim.spawnEntity(entityType, spawn_pos);

    unit.addTag(`faction:${faction}`);
    unit.addTag("spawner:" + getTag(spawner, "id:", ""));
    unit.addTag("owner:" + ownerName);

    // Tame to owner
    if (player) {
        const tame = unit.getComponent("minecraft:tameable");
        if (tame) tame.tame(player);
    }

    // Set follow mode
    unit.triggerEvent(eventName);

    // Equip gear
    equipUnit(unit, spawner, spawnerType);

    return unit;
}

function equipUnit(unit, spawner, type) {
    if (type === "dragon") {
        // Level only affects HP + attack cooldowns (handled in dragon.js).
        // Damage stays fixed.
        const level = Number(getTag(spawner, "level:", 1));
        const bonusHp = (level - 1) * DRAGON_HP_PER_LEVEL;

        system.runTimeout(() => {
            try {
                if (bonusHp > 0) {
                    // duration=999999 (effectively permanent), amplifier controls extra max HP
                    const healthBoostAmplifier = Math.max(0, Math.ceil(bonusHp / 4) - 1);
                    unit.runCommand(`effect @s health_boost 999999 ${healthBoostAmplifier} true`);
                }
                // Tag read by dragon.js for cooldown scaling
                unit.addTag(`level:${level}`);
            } catch (e) { }

            // Wait 1 tick so the effect is applied, then heal to the new max
            system.runTimeout(() => {
                try {
                    const health = unit.getComponent("minecraft:health");
                    if (health) {
                        health.setCurrentValue(health.effectiveMax);
                    }
                } catch (e) { }
            }, 1);
        }, 0);
        return;
    }

    const armor = getTag(spawner, "armor:", "None");
    const weapon = getTag(spawner, "weapon:", "None");

    const nbt = '{"minecraft:keep_on_death":{},"minecraft:item_lock":{"mode":"lock_in_inventory"}}';

    // Equipment must be applied on the next tick; the entity is not fully initialized yet
    system.runTimeout(() => {
        // === WEAPON (only barbarians still use replaceitem) ===
        if (type !== "archer") {
            const weaponMap = {
                None: "minecraft:stone_axe",
                Copper: "minecraft:copper_axe",
                Iron: "minecraft:iron_axe",
                Diamond: "minecraft:diamond_axe",
                Netherite: "minecraft:netherite_axe"
            };
            const weaponItem = weaponMap[weapon] || "minecraft:stone_axe";

            try {
                unit.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${weaponItem} 1 0 ${nbt}`);
                // Enchant netherite axe
                if (weapon === "Netherite") {
                    unit.runCommand(`enchant @s sharpness 4`);
                }
            } catch (e) { }
        }

        // === ARMOR TIER (only the property is needed for your custom render controller + damage logic) ===
        const armorTierMap = { "None": 0, "Copper": 1, "Iron": 2, "Diamond": 3, "Netherite": 4 };
        unit.setProperty("subo:armor_material", armorTierMap[armor] ?? 0);

        // === BOW TIER (for hardcoded bow) ===
        if (type === "archer") {
            const weaponTierMap = { "None": 0, "Copper": 1, "Iron": 2, "Diamond": 3, "Netherite": 4 };
            const weaponTier = weaponTierMap[weapon] ?? 0;
            unit.setProperty("subo:weapon_material", weaponTier);
        }

        // === EQUIP ARMOR (unchanged) ===
        if (armor !== "None") {
            let mat = armor.toLowerCase();
            if (mat === "gold") mat = "golden";
            const armorNbt = nbt;

            try {
                unit.runCommand(`replaceitem entity @s slot.armor.head 0 minecraft:${mat}_helmet 1 0 ${armorNbt}`);
                unit.runCommand(`replaceitem entity @s slot.armor.chest 0 minecraft:${mat}_chestplate 1 0 ${armorNbt}`);
                unit.runCommand(`replaceitem entity @s slot.armor.legs 0 minecraft:${mat}_leggings 1 0 ${armorNbt}`);
                unit.runCommand(`replaceitem entity @s slot.armor.feet 0 minecraft:${mat}_boots 1 0 ${armorNbt}`);
            } catch (e) { }
        }

    }, 0);
}
