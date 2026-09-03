export const PURIFIER_BLOCK = "subo:purifier";
export const PURIFIER_ENTITY = "subo:purifier_entity";

// ---- Empty soul -------------------------------------------------------------
export const EMPTY_SOUL_SPAWN_EVERY = 100;          // ticks between spawns
export const MAX_EMPTY_SOULS_PER_PURIFIER = 5;
export const EMPTY_SOUL_MIN_SPAWN_DIST = 15;         // min 3D distance from purifier
export const EMPTY_SOUL_MAX_SPAWN_DIST = 20;         // max 3D distance from purifier
export const Y_SPAWN_OFFSET = 10;                   // +10 to get it even higher

export const EMPTY_SOUL_MIN_SPEED = 0.04;            // blocks/tick when far away
export const EMPTY_SOUL_MAX_SPEED = 0.085;           // blocks/tick when right on top
export const EMPTY_SOUL_REACH_DIST = 0.05;           // distance at which it destroys the purifier
export const EMPTY_SOUL_SPAWN_ANIM_TICKS = 20;       // hold still for spawn anim

export const VOID_SHARD_DROP_CHANCE = 0.15;          // 15% chance on death

// ---- Undead / purify timing -------------------------------------------------
export const UNDEAD_SPAWN_EVERY = 100;              // ticks between undead spawns
export const MAX_UNDEAD_PER_PURIFIER = 60;
export const MAX_UNDEAD_SPAWN_DIST = 35;
export const MIN_PURIFY_TICKS = 1200;               // 60 s minimum runtime
export const SKY_CHECK_INTERVAL = 20;               // ticks (1 s)
export const TICKS_PER_ITEM = 20;                   // 1 s per item weight
export const MAX_STACK = 64;

export const UNDEAD = ["minecraft:zombie", "minecraft:husk", "minecraft:skeleton"];

// Night window (world.getTimeOfDay() is 0-23999)
export const NIGHT_START = 13000;
export const DAWN_START = 23000;

// Input → output mapping. Higher weight = longer purification.
// Used by both purifierLogic and emptySoul (partial drops).
export const INPUTS = [
    { id: "subo:corrupted_soul", out: "subo:pure_soul", key: "cin", label: "Corrupted Soul", weight: 10 },
    { id: "subo:rotten_heart",  out: "subo:pure_heart", key: "hin", label: "Rotten heart",  weight: 60 }
];