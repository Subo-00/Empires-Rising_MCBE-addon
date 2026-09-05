/** Dragon base HP and HP gained per level */
export const DRAGON_BASE_HP = 20;  // should match minecraft:health value in the entity's JSON file

export const DRAGON_HP_PER_LEVEL = 10;

/** Max level a dragon can reach */
export const DRAGON_MAX_LEVEL = 5;

/** Spawning costs per unit type */
export const SPAWN_COSTS = {
    barbarian: { item: "subo:pure_soul", amount: 10 },
    archer: { item: "subo:pure_soul", amount: 12 },
    dragon: { item: "subo:pure_heart", amount: 1 }
};

/** Cap limits and upgrade info */
export const CAP_CONFIG = {
    barbarian: { start: 2, max: 5, upgradeItem: "subo:pure_heart", upgradePrice: 1, jump: 1 },
    archer: { start: 2, max: 5, upgradeItem: "subo:pure_heart", upgradePrice: 1, jump: 1 },
    dragon: { start: 1, max: 1, upgradeItem: null, upgradePrice: 0, jump: 0 }
};

/** Upgrade tiers in order (order matters for sequential upgrade checks) */
export const TIERS = ["Copper", "Iron", "Diamond", "Netherite"];

/** Minecraft color codes for each tier (used in UI and lore) */
export const TIER_COLORS = {
    None: "§8",
    Copper: "§6",
    Iron: "§f",
    Diamond: "§b",
    Netherite: "§5"
};

/** Color codes for each stat label in menus */
export const STAT_COLORS = {
    owner: "§e",
    armor: "§d",
    weapon: "§c",
    cap: "§b"
};

/** Block item required to purchase each tier upgrade */
export const COST_ITEMS = {
    Copper: "minecraft:copper_block",
    Iron: "minecraft:iron_block",
    Diamond: "minecraft:diamond_block",
    Netherite: "minecraft:netherite_block"
};

/** Interaction cooldown in milliseconds (prevents double-open) */
export const INTERACT_COOLDOWN_MS = 300;

/** Delay between successive unit spawns from the same spawner (ticks) */
export const SPAWN_DELAY_TICKS = 40;

/** Entity / block IDs */
export const SPAWNER_ENTITY = "subo:spawner_entity";

export const SPAWNER_BLOCK_IDS = [
    "subo:barbarian_spawner",
    "subo:archer_spawner",
    "subo:dragon_spawner"
];

/** Faction display data */
export const FACTION_NAMES = { 1: "Fire", 2: "Water", 3: "Void" };
export const FACTION_COLORS = { 1: "§c", 2: "§9", 3: "§5" };
export const FACTION_MAP = { 1: "fire", 2: "water", 3: "void" };


/** Player Feedback ============================================================================================== */

/** Visual + audio feedback at a location */
export function playSpawnerFeedback(dim, loc, soundId, particleId, count = 10, pitch = 1.0) {
    try {
        dim.playSound(soundId, loc, { volume: 1.0, pitch });
        if (count === 1) {dim.spawnParticle(particleId, loc); return;};
        for (let i = 0; i < count; i++) {
            const p = {
                x: loc.x + (Math.random() - 0.5) * 1.4,
                y: loc.y + 0.3 + Math.random() * 1.0,
                z: loc.z + (Math.random() - 0.5) * 1.4
            };
            dim.spawnParticle(particleId, p);
        }
    } catch { }
}

/** Armor-tier specific feedback */
export function playArmorUpgradeFeedback(dim, loc, tier) {
    const map = {
        Copper: { sound: "armor.equip_iron", particle: "minecraft:basic_flame_particle", pitch: 1.2 },
        Iron: { sound: "armor.equip_iron", particle: "minecraft:basic_smoke_particle", pitch: 1.0 },
        Diamond: { sound: "armor.equip_diamond", particle: "minecraft:endrod", pitch: 1.1 },
        Netherite: { sound: "armor.equip_netherite", particle: "minecraft:basic_portal_particle", pitch: 0.85 }
    };
    const cfg = map[tier] ?? { sound: "armor.equip_generic", particle: "minecraft:villager_happy", pitch: 1.0 };
    playSpawnerFeedback(dim, loc, cfg.sound, cfg.particle, 12, cfg.pitch);
}

/** Weapon-tier specific feedback (distinct from armor) */
export function playWeaponUpgradeFeedback(dim, loc, tier) {
    const map = {
        Copper: { sound: "random.anvil_use", particle: "minecraft:critical_hit_emitter", count: 1, pitch: 1.3 },
        Iron: { sound: "random.anvil_use", particle: "minecraft:critical_hit_emitter", count: 1, pitch: 1.1 },
        Diamond: { sound: "random.anvil_use", particle: "minecraft:endrod", pitch: 1.0 },
        Netherite: { sound: "random.anvil_use", particle: "minecraft:basic_portal_particle", pitch: 0.8 }
    };
    const cfg = map[tier] ?? { sound: "random.anvil_use", particle: "minecraft:critical_hit_emitter", pitch: 1.0 };
    playSpawnerFeedback(dim, loc, cfg.sound, cfg.particle, cfg.count ?? 14, cfg.pitch);
}

/** Cap upgrade – deliberately different feel */
export function playCapUpgradeFeedback(dim, loc) {
    playSpawnerFeedback(dim, loc, "random.levelup", "minecraft:villager_happy", 16, 1.15);
}

/** Dragon level upgrade */
export function playDragonLevelFeedback(dim, loc) {
    playSpawnerFeedback(dim, loc, "random.levelup", "minecraft:dragon_breath_trail", 18, 0.9);
    // extra portal-y burst
    playSpawnerFeedback(dim, loc, "portal.trigger", "minecraft:basic_portal_particle", 10, 1.2);
}

/** Ordering / queuing troops */
export function playSpawnOrderFeedback(dim, loc) {
    playSpawnerFeedback(dim, loc, "random.orb", "minecraft:villager_happy", 8, 1.4);
}