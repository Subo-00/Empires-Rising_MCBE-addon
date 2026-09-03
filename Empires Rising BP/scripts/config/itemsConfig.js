//-------------------------------------------------------------------------------------------------
// Portal Config
//-------------------------------------------------------------------------------------------------
export const ACTIVE_SECONDS = 6;     // for how long the portal stays open after activation
export const TROOP_RADIUS = 20;     // the radius around the portal in which troops get teleported with the player


//-------------------------------------------------------------------------------------------------
// Troop Horn Config
//-------------------------------------------------------------------------------------------------
// How long (in ticks) counts as a "short" press.
// 1.5 s use_duration = 30 ticks. Anything released before ~12 ticks = Follow.
export const SHORT_PRESS_TICKS = 12;

// Radius in which troops hear the trumpet
export const RADIUS = 100;


//-------------------------------------------------------------------------------------------------
// Milk Potion Config
//-------------------------------------------------------------------------------------------------
export const MILK_PROJECTILE_ID = "subo:milk_potion_projectile";
export const SPLASH_RADIUS = 5;     // SHARED BY BOTH POTION BLASTER AND MILK POTION


//-------------------------------------------------------------------------------------------------
// Potion Blaster Config
//-------------------------------------------------------------------------------------------------
export const MAX_POTIONS = 64;

// Base (tier I, normal duration) data for each potion. `hasStrong` = a "II" (strong_) variant
// exists in vanilla, `hasLong` = an extended-duration (long_) variant exists in vanilla.
export const BASE_POTIONS = {
    healing:         { name: "Healing",         effect: "instant_health", amplifier: 1, duration: 1,    hasStrong: true,  hasLong: false },
    harming:         { name: "Harming",         effect: "instant_damage", amplifier: 1, duration: 1,    hasStrong: true,  hasLong: false },
    poison:          { name: "Poison",          effect: "poison",         amplifier: 0, duration: 180,  hasStrong: true,  hasLong: true  },
    regeneration:    { name: "Regeneration",    effect: "regeneration",   amplifier: 1, duration: 180,  hasStrong: true,  hasLong: true  },
    strength:        { name: "Strength",        effect: "strength",       amplifier: 1, duration: 1800, hasStrong: true,  hasLong: true  },
    swiftness:       { name: "Swiftness",       effect: "speed",          amplifier: 1, duration: 1800, hasStrong: true,  hasLong: true  },
    slowness:        { name: "Slowness",        effect: "slowness",       amplifier: 1, duration: 1800, hasStrong: false, hasLong: true  },
    fire_resistance: { name: "Fire Resistance", effect: "fire_resistance",amplifier: 0, duration: 1800, hasStrong: false, hasLong: true  },
    weakness:        { name: "Weakness",        effect: "weakness",       amplifier: 0, duration: 1800, hasStrong: false, hasLong: true  },
    night_vision:    { name: "Night Vision",    effect: "night_vision",   amplifier: 0, duration: 3600, hasStrong: false, hasLong: true  },
    invisibility:    { name: "Invisibility",    effect: "invisibility",   amplifier: 0, duration: 1800, hasStrong: false, hasLong: true  },
    leaping:         { name: "Leaping",         effect: "jump_boost",     amplifier: 1, duration: 1800, hasStrong: true,  hasLong: true  },
};

export const BASE_COLORS = {
    healing:         { r: 0.89, g: 0.15, b: 0.15 },
    harming:         { r: 0.26, g: 0.04, b: 0.04 },
    poison:          { r: 0.31, g: 0.58, b: 0.19 },
    regeneration:    { r: 0.80, g: 0.36, b: 0.67 },
    strength:        { r: 0.58, g: 0.14, b: 0.14 },
    swiftness:       { r: 0.49, g: 0.69, b: 0.78 },
    slowness:        { r: 0.35, g: 0.42, b: 0.51 },
    fire_resistance: { r: 0.89, g: 0.60, b: 0.23 },
    weakness:        { r: 0.28, g: 0.30, b: 0.28 },
    night_vision:    { r: 0.12, g: 0.62, b: 0.65 },
    invisibility:    { r: 0.50, g: 0.51, b: 0.57 },
    leaping:         { r: 0.13, g: 1.00, b: 0.30 },
};