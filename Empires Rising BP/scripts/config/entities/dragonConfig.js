export const RIDER_FIREBALL_COOLDOWN_TICKS = 100;
export const RIDER_BITE_COOLDOWN_TICKS     = 50;
export const RIDER_BITE_AOE_RANGE          = 4;
export const RIDER_BITE_MAX_TARGETS        = 3;
export const RIDER_FIREBALL_REACH          = 64;

export const BITE_COOLDOWN_TICKS = 60;
export const SPIT_COOLDOWN_TICKS = 120;
export const BITE_RANGE          = 2;
export const SPIT_RANGE          = 40;

export const FOLLOW_LEASH  = 6;
export const MAX_HSPEED    = 2.0;
export const MAX_VSPEED    = 0.8;
export const MAX_IMPULSE   = 0.8;

export const COMBAT_FLY_HEIGHT = 6;
export const COMBAT_FLY_RADIUS = 8;
export const COMBAT_LAND_DELAY = 40;

/** Level → cooldown scale (L1 = 100 %, L5 ≈ 40 %). */
export function scaleCooldown(baseTicks, level) {
    const factor = Math.max(0.4, 1 - (level - 1) * 0.15);
    return Math.max(1, Math.floor(baseTicks * factor));
}

// Note: Checkout spawnerConfig.js for dragons per level extra HP