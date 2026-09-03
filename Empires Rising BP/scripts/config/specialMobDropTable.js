// -------- Special Mob Drop Configuration --------
export const DROP_TABLE = {
    // ── Common undead / basic hostiles ──────────────────────────────
    "minecraft:zombie": { corrupted_soul: 0.15, rotten_heart: 0.005 },
    "minecraft:husk": { corrupted_soul: 0.16, rotten_heart: 0.006 },
    "minecraft:drowned": { corrupted_soul: 0.16, rotten_heart: 0.006 },
    "minecraft:skeleton": { corrupted_soul: 0.15, rotten_heart: 0.005 },
    "minecraft:stray": { corrupted_soul: 0.16, rotten_heart: 0.006 },
    "minecraft:creeper": { corrupted_soul: 0.12, rotten_heart: 0.004 },
    "minecraft:spider": { corrupted_soul: 0.12, rotten_heart: 0.004 },
    "minecraft:cave_spider": { corrupted_soul: 0.14, rotten_heart: 0.005 },
    "minecraft:slime": { corrupted_soul: 0.10, rotten_heart: 0.003 },

    // ── Uncommon / mid-tier ─────────────────────────────────────────
    "minecraft:phantom": { corrupted_soul: 0.18, rotten_heart: 0.010 },
    "minecraft:enderman": { corrupted_soul: 0.22, rotten_heart: 0.012 },
    "minecraft:witch": { corrupted_soul: 0.20, rotten_heart: 0.010 },
    "minecraft:blaze": { corrupted_soul: 0.20, rotten_heart: 0.010 },
    "minecraft:magma_cube": { corrupted_soul: 0.15, rotten_heart: 0.006 },
    "minecraft:ghast": { corrupted_soul: 0.25, rotten_heart: 0.030 },
    "minecraft:guardian": { corrupted_soul: 0.20, rotten_heart: 0.010 },

    // ── Rare / strong ───────────────────────────────────────────────
    "minecraft:wither_skeleton": { corrupted_soul: 0.40, rotten_heart: 0.025 },
    "minecraft:elder_guardian": { corrupted_soul: 0.40, rotten_heart: 0.035 },
    "minecraft:shulker": { corrupted_soul: 0.30, rotten_heart: 0.022 },
    "minecraft:endermite": { corrupted_soul: 0.25, rotten_heart: 0.015 },

    // ── Very rare / elite ───────────────────────────────────────────
    "minecraft:wither": { corrupted_soul: 0.60, rotten_heart: 0.50 },
    "minecraft:warden": { corrupted_soul: 0.70, rotten_heart: 0.35 },

    // Custom mobs
    "subo:dark_knight": { corrupted_soul: 0.45, rotten_heart: 0.30 },
    "subo:lava_golem": { corrupted_soul: 0.45, rotten_heart: 0.30 },

    // Fallback for any other hostile mob
    "default": { corrupted_soul: 0.01, rotten_heart: 0.001 }
};