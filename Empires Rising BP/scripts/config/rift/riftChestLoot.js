export const CHEST_SPAWN_CHANCE = 0.6;

// ────────────────────────────────────────────────
//  Loot table – single weighted system (5 tiers)
//  Every stack is rolled independently → chests mix tiers.
//  Tier 5 weight is tuned so you get ~1 best item per 10 chests
//  (assuming average 5 stacks/chest).
// ────────────────────────────────────────────────
export const LOOT_TIERS = [
  // Tier 1 – Common (~50 %)
  {
    weight: 50,
    items: [
      { id: "minecraft:iron_ingot", min: 2, max: 6 },
      { id: "minecraft:gold_ingot", min: 1, max: 4 },
      { id: "minecraft:coal", min: 4, max: 12 },
      { id: "minecraft:nether_quartz", min: 3, max: 8 },
      { id: "minecraft:blaze_rod", min: 1, max: 3 },
      { id: "minecraft:magma_cream", min: 1, max: 4 },
      { id: "minecraft:glowstone_dust", min: 2, max: 6 },
      { id: "minecraft:nether_brick", min: 4, max: 10 },
      { id: "minecraft:arrow", min: 8, max: 16 },
      { id: "minecraft:gold_nugget", min: 4, max: 12 },
    ]
  },

  // Tier 2 – Uncommon (~25 %)
  {
    weight: 25,
    items: [
      { id: "minecraft:diamond", min: 1, max: 2 },
      { id: "minecraft:golden_apple", min: 1, max: 2 },
      { id: "minecraft:blaze_powder", min: 2, max: 5 },
      { id: "minecraft:gunpowder", min: 2, max: 5 },
      { id: "minecraft:ghast_tear", min: 1, max: 2 },
      { id: "minecraft:ender_pearl", min: 1, max: 3 },
      { id: "minecraft:obsidian", min: 2, max: 5 },
      { id: "minecraft:crying_obsidian", min: 1, max: 3 },
      { id: "minecraft:spectral_arrow", min: 4, max: 10 },
      { id: "minecraft:experience_bottle", min: 2, max: 6 },
    ]
  },

  // Tier 3 – Rare (~15 %)
  {
    weight: 15,
    items: [
      { id: "minecraft:diamond", min: 2, max: 4 },
      { id: "minecraft:ancient_debris", min: 1, max: 1 },
      { id: "minecraft:golden_carrot", min: 2, max: 5 },
      { id: "minecraft:experience_bottle", min: 4, max: 10 },
      { id: "minecraft:totem_of_undying", min: 1, max: 1 },
    ]
  },

  // Tier 4 – Very Rare (~8 %)
  {
    weight: 8,
    items: [
      { id: "minecraft:netherite_scrap", min: 1, max: 2 },
      { id: "minecraft:ancient_debris", min: 1, max: 2 },
      { id: "minecraft:enchanted_golden_apple", min: 1, max: 1 },
      { id: "minecraft:netherite_upgrade_smithing_template", min: 1, max: 1 },
      // Near-max useful books
      { type: "book", enchant: "sharpness", level: 5 },
      { type: "book", enchant: "protection", level: 4 },
      { type: "book", enchant: "fire_protection", level: 4 },
      { type: "book", enchant: "unbreaking", level: 3 },
      { type: "book", enchant: "efficiency", level: 5 },
      { type: "book", enchant: "fortune", level: 3 },
      { type: "book", enchant: "looting", level: 3 },
      { type: "book", enchant: "soul_speed", level: 3 },
      { type: "book", enchant: "feather_falling", level: 3 },
    ]
  },

  // Tier 5 – Ultra Rare (~2 %)  → ~1 item every 10 chests
  {
    weight: 2,
    items: [
      { id: "minecraft:enchanted_golden_apple", min: 1, max: 1 },
      { id: "minecraft:nether_star", min: 1, max: 1 },
      { id: "minecraft:netherite_ingot", min: 1, max: 1 },
      // Best books
      { type: "book", enchant: "mending", level: 1 },
      { type: "book", enchant: "sharpness", level: 5 },
      { type: "book", enchant: "protection", level: 4 },
      { type: "book", enchant: "fortune", level: 3 },
      { type: "book", enchant: "looting", level: 3 },
      { type: "book", enchant: "soul_speed", level: 3 },
      { type: "book", enchant: "swift_sneak", level: 3 },
    ]
  },
];
