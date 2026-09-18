// ────────────────────────────────────────────────
//  Spirit system configuration & balance
//  Easy-to-tweak constants at the top of each section.
// ────────────────────────────────────────────────

// ── Core ──
export const MAX_LEVEL = 100;

export const BOB_SPEED = 0.08;
export const FOLLOW_DIST = 1.2;
export const FOLLOW_HEIGHT = 1.6;

/** Auto-target (no LOS needed) if this close to the player. */
export const CLOSE_PRIORITY_DIST = 1.5;
export const CLOSE_PRIORITY_DIST_SQ = CLOSE_PRIORITY_DIST * CLOSE_PRIORITY_DIST;

export const SPIRIT_ITEMS = {
    vigor: "subo:vigor_spirit",
    pyro: "subo:pyro_spirit",
    frost: "subo:frost_spirit"
};

export const SPIRIT_ENTITIES = {
    vigor: "subo:vigor_spirit_entity",
    pyro: "subo:pyro_spirit_entity",
    frost: "subo:frost_spirit_entity"
};

export const PYRO_PROJECTILE_ENTITY = "subo:pyro_spirit_projectile";

// ────────────────────────────────────────────────
//  VIGOR 
// ────────────────────────────────────────────────
const VIGOR_HEAL_BASE          = 2;      // HP at level 0
const VIGOR_HEAL_PER_LEVEL     = 0.06;   // extra HP per level
const VIGOR_HEAL_INTERVAL_BASE = 400;    // ticks at level 0 (~20 s)
const VIGOR_HEAL_INTERVAL_PER  = 4.4;    // ticks removed per level
const VIGOR_HEAL_INTERVAL_MIN  = 160;    // floor (~8 s)

const VIGOR_REPEL_CD_BASE      = 600;
const VIGOR_REPEL_CD_PER       = 5;
const VIGOR_REPEL_CD_MIN       = 80;

const VIGOR_REPEL_FORCE_BASE   = 1.4;
const VIGOR_REPEL_FORCE_PER    = 0.028;

const VIGOR_REPEL_RADIUS_BASE  = 4;
const VIGOR_REPEL_RADIUS_STEP  = 0.6;    // every 12 levels
const VIGOR_REPEL_RADIUS_EVERY = 12;

const VIGOR_REPEL_UP_BASE      = 0.40;
const VIGOR_REPEL_UP_PER       = 0.0045;

export function vigorHealAmount(lvl) {
    return VIGOR_HEAL_BASE + Math.floor(lvl * VIGOR_HEAL_PER_LEVEL);
}
export function vigorHealInterval(lvl) {
    return Math.max(VIGOR_HEAL_INTERVAL_MIN, VIGOR_HEAL_INTERVAL_BASE - lvl * VIGOR_HEAL_INTERVAL_PER);
}
export function vigorRepelCooldownTicks(lvl) {
    return Math.max(VIGOR_REPEL_CD_MIN, VIGOR_REPEL_CD_BASE - lvl * VIGOR_REPEL_CD_PER);
}
export function vigorRepelForce(lvl) {
    return VIGOR_REPEL_FORCE_BASE + lvl * VIGOR_REPEL_FORCE_PER;
}
export function vigorRepelRadius(lvl) {
    return VIGOR_REPEL_RADIUS_BASE + Math.floor(lvl / VIGOR_REPEL_RADIUS_EVERY) * VIGOR_REPEL_RADIUS_STEP;
}
export function vigorRepelUpward(lvl) {
    return VIGOR_REPEL_UP_BASE + lvl * VIGOR_REPEL_UP_PER;
}

// ────────────────────────────────────────────────
//  PYRO
// ────────────────────────────────────────────────
const PYRO_SHOOT_INTERVAL_BASE = 40;
const PYRO_SHOOT_INTERVAL_PER  = 0.3;
const PYRO_SHOOT_INTERVAL_MIN  = 10;

const PYRO_DAMAGE_BASE         = 3;
const PYRO_DAMAGE_PER_LEVEL    = 0.22;

const PYRO_TARGET_COUNT_BASE   = 1;
const PYRO_TARGET_COUNT_EVERY  = 10;     // +1 target every N levels
const PYRO_TARGET_COUNT_MAX    = 6;

const PYRO_KB_H_BASE           = 0.35;
const PYRO_KB_H_PER            = 0.004;
const PYRO_KB_V_BASE           = 0.18;
const PYRO_KB_V_PER            = 0.0015;

const PYRO_BURN_BASE           = 2;      // seconds
const PYRO_BURN_EVERY          = 25;     // +1 s every N levels

/** Targeting range (blocks from player). */
const PYRO_RANGE_BASE          = 12;
const PYRO_RANGE_PER_LEVEL     = 0.06;   // → ~18 at lvl 100
const PYRO_RANGE_MAX           = 20;

export function pyroShootInterval(lvl) {
    return Math.max(PYRO_SHOOT_INTERVAL_MIN, PYRO_SHOOT_INTERVAL_BASE - Math.floor(lvl * PYRO_SHOOT_INTERVAL_PER));
}
export function pyroDamage(lvl) {
    return PYRO_DAMAGE_BASE + Math.floor(lvl * PYRO_DAMAGE_PER_LEVEL);
}
export function pyroTargetCount(lvl) {
    return Math.min(PYRO_TARGET_COUNT_MAX, PYRO_TARGET_COUNT_BASE + Math.floor(lvl / PYRO_TARGET_COUNT_EVERY));
}
export function pyroKnockbackHorizontal(lvl) {
    return PYRO_KB_H_BASE + lvl * PYRO_KB_H_PER;
}
export function pyroKnockbackVertical(lvl) {
    return PYRO_KB_V_BASE + lvl * PYRO_KB_V_PER;
}
export function pyroBurnSeconds(lvl) {
    return PYRO_BURN_BASE + Math.floor(lvl / PYRO_BURN_EVERY);
}
export function pyroTargetRange(lvl) {
    return Math.min(PYRO_RANGE_MAX, PYRO_RANGE_BASE + lvl * PYRO_RANGE_PER_LEVEL);
}

// ────────────────────────────────────────────────
//  FROST
// ────────────────────────────────────────────────
const FROST_ABILITY_INTERVAL_BASE = 120;
const FROST_ABILITY_INTERVAL_PER  = 0.7;
const FROST_ABILITY_INTERVAL_MIN  = 80;

const FROST_DURATION_BASE         = 40;   // ticks
const FROST_DURATION_PER          = 0.8;

const FROST_SIZE_BASE             = 4.0;
const FROST_SIZE_STEP             = 0.6;
const FROST_SIZE_EVERY            = 20;

const FROST_SLOW_AMP_EVERY        = 30;
const FROST_SLOW_AMP_MAX          = 3;

const FROST_SLOW_DUR_BASE         = 35;   // ticks
const FROST_SLOW_DUR_PER          = 0.15;

const FROST_FIRE_DMG_BASE         = 0.5;
const FROST_FIRE_DMG_EVERY        = 15;
const FROST_FIRE_DMG_MIN_LEVEL    = 5;    // no extra dmg below this

const FROST_LIGHT_BASE            = 4;
const FROST_LIGHT_EVERY           = 7;
const FROST_LIGHT_MAX             = 13;

/** Targeting range (blocks from player). */
const FROST_RANGE_BASE            = 16;
const FROST_RANGE_PER_LEVEL       = 0.08; // → ~24 at lvl 100
const FROST_RANGE_MAX             = 28;

/** Movement / hover (not level-scaled). */
export const FROST_HOVER_HEIGHT   = 1.9;
export const FROST_SIDE_OFFSET    = 0.85;
export const FROST_SPIRAL_SPEED   = 0.035; // rad/tick
export const FROST_SPIRAL_RADIUS  = 1.5;
/** Max travel speed (blocks/tick) while switching targets / following. */
export const FROST_SWITCH_SPEED   = 0.12;
export const FROST_FOLLOW_SPEED   = 1.10;
/** Arc strength while travelling (0 = straight line). */
export const FROST_ARC_STRENGTH   = 0.22;

export function frostAbilityInterval(lvl) {
    return Math.max(FROST_ABILITY_INTERVAL_MIN, FROST_ABILITY_INTERVAL_BASE - Math.floor(lvl * FROST_ABILITY_INTERVAL_PER));
}
export function frostDuration(lvl) {
    return FROST_DURATION_BASE + Math.floor(lvl * FROST_DURATION_PER);
}
export function frostSize(lvl) {
    return FROST_SIZE_BASE + Math.floor(lvl / FROST_SIZE_EVERY) * FROST_SIZE_STEP;
}
export function frostSlownessAmplifier(lvl) {
    return Math.min(FROST_SLOW_AMP_MAX, Math.floor(lvl / FROST_SLOW_AMP_EVERY));
}
export function frostSlownessDuration(lvl) {
    return FROST_SLOW_DUR_BASE + Math.floor(lvl * FROST_SLOW_DUR_PER);
}
export function frostFireDamage(lvl) {
    if (lvl <= FROST_FIRE_DMG_MIN_LEVEL) return 0;
    return FROST_FIRE_DMG_BASE + (Math.floor(lvl / FROST_FIRE_DMG_EVERY) / 2);
}
export function frostLightLevel(lvl) {
    return Math.min(FROST_LIGHT_MAX, FROST_LIGHT_BASE + Math.floor(lvl / FROST_LIGHT_EVERY));
}
export function frostTargetRange(lvl) {
    return Math.min(FROST_RANGE_MAX, FROST_RANGE_BASE + lvl * FROST_RANGE_PER_LEVEL);
}