export const RIFT_DIMENSION_ID = "subo:rift_realm";
export const RIFT_BLOCK = "subo:rift_port";
export const RIFT_ENTITY = "subo:rift_port_entity";

export const RIFT_KEY_ID = "subo:rift_key";
export const OPEN_DURATION_TICKS = 10 * 20;   // 10 seconds

// ────────────────────────────────────────────────
//  Surrounding Box
// ────────────────────────────────────────────────
export const BOTTOM_BLOCK = "magma";
export const WALL_BLOCK = "netherrack";

export const BOX_SIZE = 160;         // exactly 100 chunks when aligned
export const BOX_HEIGHT_OFFSET = 75;          // ±75 from fortress centre
export const FORTRESS_Y_OFFSET = -40;       // fortress/chests/spawns y offset inside the box

export const ISLAND_SPACING = 400;        // keep devisable by 16!

// ────────────────────────────────────────────────
//  LAYOUT DEFINITIONS
//  Each layout owns its own:
//    • fortress offset (how far the whole build is shifted from box origin)
//    • structure pieces
//    • player spawn points
//    • chest points
// ────────────────────────────────────────────────
export const LAYOUTS = [
  // ── Layout 1 ──────────────────────────────
  {
    id: 0,
    offsetX: 10,
    offsetZ: 10,
    pieces: [
      { name: "rift_fort:0_0_rift_fort", x: 0, z: 0 },
      { name: "rift_fort:0_50_rift_fort", x: 0, z: 50 },
      { name: "rift_fort:100_50_rift_fort", x: 100, z: 50 },
      { name: "rift_fort:50_0_rift_fort", x: 50, z: 0 },
      { name: "rift_fort:50_100_rift_fort", x: 50, z: 100 },
      { name: "rift_fort:50_50_rift_fort", x: 50, z: 50 },
    ],
    spawnOffsets: [
      { x: 67, y: 152 - 146, z: 43 },
    ],
    // Split by chunks (structure blocks)
    chestOffsets: [
      { x: 73, y: 10, z: 14, facing: "west" },
      { x: 73, y: 10, z: 32, facing: "west" },
      { x: 74, y: 15, z: 22, facing: "west" },
      { x: 66, y: 20, z: 11, facing: "east" },
      { x: 67, y: 21, z: 33, facing: "north" },
      { x: 72, y: 25, z: 11, facing: "west" },
      { x: 70, y: 25, z: 29, facing: "south" },
      { x: 80, y: 23, z: 42, facing: "west" },
      { x: 54, y: 23, z: 46, facing: "east" },

      { x: 14, y: 5, z: 67, facing: "west" },
      { x: 13, y: 5, z: 98, facing: "west" },
      { x: 43, y: 25, z: 58, facing: "south" },
      { x: 43, y: 25, z: 70, facing: "north" },
      { x: 34, y: 23, z: 81, facing: "east" },

      { x: 63, y: 26, z: 60, facing: "east" },
      { x: 71, y: 26, z: 60, facing: "west" },
      { x: 71, y: 26, z: 68, facing: "west" },
      { x: 63, y: 26, z: 68, facing: "east" },
      { x: 63, y: 26, z: 99, facing: "east" },
      { x: 71, y: 26, z: 99, facing: "west" },
      { x: 71, y: 26, z: 91, facing: "west" },
      { x: 63, y: 26, z: 91, facing: "east" },
      { x: 91, y: 25, z: 70, facing: "north" },
      { x: 91, y: 25, z: 58, facing: "south" },
      { x: 67, y: 16, z: 91, facing: "south" },
      { x: 67, y: 16, z: 68, facing: "north" },

      { x: 124, y: 46, z: 64, facing: "east" },
      { x: 123, y: 5, z: 91, facing: "east" },
      { x: 121, y: 5, z: 68, facing: "east" },

      { x: 64, y: 5, z: 136, facing: "north" },
    ],
  },

  // ── Layout 2 ──────────────────────────────
  {
    id: 1,
    offsetX: 10,
    offsetZ: 10,
    pieces: [
      { name: "rift_fort_2:0_0_rift_fort_2", x: 0, z: 0 },
      { name: "rift_fort_2:0_50_rift_fort_2", x: 0, z: 50 },
      { name: "rift_fort_2:100_50_rift_fort_2", x: 100, z: 50 },
      { name: "rift_fort_2:50_0_rift_fort_2", x: 50, z: 0 },
      { name: "rift_fort_2:50_100_rift_fort_2", x: 50, z: 100 },
      { name: "rift_fort_2:50_50_rift_fort_2", x: 50, z: 50 },
    ],
    spawnOffsets: [
      { x: 68, y: 5, z: 50 },
    ],
    chestOffsets: [
      { x: 16, y: 31, z: 10, facing: "south" },
      { x: 1, y: 31, z: 26, facing: "east" },
      { x: 27, y: 52, z: 20, facing: "south" },
      { x: 24, y: 28, z: 19, facing: "south" },
      { x: 33, y: 26, z: 34, facing: "south" },
      { x: 14, y: 26, z: 36, facing: "east" },
      { x: 17, y: 30, z: 32, facing: "west" },
      { x: 17, y: 27, z: 24, facing: "west" },
      { x: 15, y: 14, z: 31, facing: "north" },
      { x: 15, y: 14, z: 18, facing: "south" },
      { x: 38, y: 5, z: 11, facing: "south" },
      { x: 2, y: 5, z: 22, facing: "east" },
      { x: 2, y: 5, z: 28, facing: "east" },
      { x: 19, y: 5, z: 31, facing: "north" },
      { x: 40, y: 4, z: 38, facing: "north" },

      { x: 71, y: 24, z: 36, facing: "south" },
      { x: 73, y: 24, z: 26, facing: "west" },
      { x: 70, y: 20, z: 40, facing: "north" },
      { x: 75, y: 14, z: 29, facing: "west" },
      { x: 66, y: 14, z: 11, facing: "south" },
      { x: 66, y: 9, z: 10, facing: "south" },

      { x: 15, y: 4, z: 74, facing: "west" },
      { x: 13, y: 4, z: 98, facing: "west" },
      { x: 10, y: 45, z: 102, facing: "west" },
      { x: 35, y: 22, z: 88, facing: "east" },
      { x: 44, y: 24, z: 77, facing: "north" },
      { x: 44, y: 24, z: 65, facing: "south" },

      { x: 84, y: 22, z: 53, facing: "west" },
      { x: 64, y: 25, z: 67, facing: "east" },
      { x: 64, y: 25, z: 75, facing: "east" },
      { x: 72, y: 25, z: 75, facing: "west" },
      { x: 101, y: 22, z: 84, facing: "west" },
      { x: 92, y: 24, z: 65, facing: "south" },
      { x: 92, y: 24, z: 77, facing: "north" },
      { x: 68, y: 15, z: 75, facing: "north" },

      { x: 122, y: 4, z: 71, facing: "east" },
      { x: 124, y: 4, z: 102, facing: "east" },
      { x: 127, y: 45, z: 102, facing: "east" },

      { x: 72, y: 25, z: 106, facing: "west" },
      { x: 72, y: 25, z: 98, facing: "west" },
      { x: 64, y: 25, z: 98, facing: "east" },
      { x: 64, y: 25, z: 106, facing: "east" },
      { x: 68, y: 15, z: 98, facing: "south" },
      { x: 70, y: 4, z: 142, facing: "north" },
      { x: 66, y: 24, z: 141, facing: "north" },
    ],
  },
];

// replace roof with glass here  (place all on first gen because we only create the box once)
export const BEACON_OFFSETS = [
  { x: 67, z: 131 },
  { x: 68, z: 138 }
]

// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Mobs allowed to spawn in the Rift */
export const ALLOWED_RIFT_MOBS = new Set([
  "subo:fire_spark",
  "minecraft:magma_cube",
  "minecraft:blaze",
  "minecraft:wither_skeleton",
  "minecraft:husk",
  "minecraft:parched",
  "minecraft:bogged",
  "minecraft:spider"
]);

/** Items that are removed when they appear as drops in the Rift */
export const RIFT_ITEM_BLACKLIST = new Set([
  "minecraft:coal",
  "minecraft:bone",
  "minecraft:string",
  "minecraft:magma_cream",
  "minecraft:arrow",
  "minecraft:rotten_flesh"
]);

/**
 * Difficulty tiers built from ALLOWED_RIFT_MOBS (weak → strong).
 * Weights are base weights; higher tiers start rare and become more common
 * as the player's highest spirit level rises (see getSpawnWeights).
 *
 * Tier 0 – fodder (always common)
 * Tier 1 – mid
 * Tier 2 – strong (blaze / wither / fire_spark)
 */
export const RIFT_MOB_TIERS = [
  // Tier 0 – weak / volume
  [
    { id: "minecraft:spider", weight: 30 },
    { id: "minecraft:husk", weight: 25 },
    { id: "minecraft:parched", weight: 25 },
    { id: "minecraft:bogged", weight: 20 },
    { id: "minecraft:magma_cube", weight: 20 },
  ],
  // Tier 1 – mid
  [
    { id: "minecraft:magma_cube", weight: 25 },
    { id: "minecraft:bogged", weight: 20 },
    { id: "subo:fire_spark", weight: 15 },
    { id: "minecraft:husk", weight: 15 },
  ],
  // Tier 2 – strong (start rare, scale up with spirit level)
  [
    { id: "minecraft:blaze", weight: 20 },
    { id: "minecraft:wither_skeleton", weight: 18 },
    { id: "subo:fire_spark", weight: 22 },
  ],
];

/**
 * Forced-spawn curves vs the player's highest spirit level.
 *
 * `levelCap` must match spiritsConfig.MAX_LEVEL (currently 60).
 * All *At0 / *AtMax values are lerped with:
 *   t = clamp(highestSpiritLevel / levelCap, 0, 1)
 *
 * Goal: sparse at low level, constant pressure at max — without exploding
 * cost when several players share a rift (soft caps + clustering).
 */
export const RIFT_SPAWN = {
  // ── Spirit level that represents "max difficulty" ──────────────────────
  levelCap: 60,

  // ── Mobs attempted per player per ticker cycle ─────────────────────────
  // Low level: small waves. Max level: large waves (Pyro needs volume).
  countMinAt0: 1,       // min mobs at spirit level 0
  countMaxAt0: 2,       // max mobs at spirit level 0
  countMinAtMax: 6,     // min mobs at levelCap
  countMaxAtMax: 10,    // max mobs at levelCap

  // ── Ticker interval (ticks, 20 = 1 second) ──────────────────────────────
  // Faster interval at high level → constant pressure.
  // Empty dimension / low level stays slow to save CPU.
  intervalAt0: 100,     // 5.0 s between waves at level 0
  intervalAtMax: 40,    // 2.0 s between waves at levelCap

  // ── Soft population cap (monsters already near the player) ─────────────
  // If nearby count ≥ cap, skip this player for the cycle.
  // Prevents unbounded growth with multiple players / slow kills.
  maxNearbyAt0: 6,      // max living monsters near player at level 0
  maxNearbyAtMax: 15,   // max living monsters near player at levelCap
  nearbyCheckRadius: 14,// blocks radius used for the nearby count

  // ── Cluster size (mobs placed per valid ground hit) ────────────────────
  // Finding valid ground is the expensive part (getBlock loops).
  // At high level we place several mobs on/around one good spot.
  clusterSizeAt0: 1,    // 1 mob per successful ground find at level 0
  clusterSizeAtMax: 3,  // up to 3 mobs per successful ground find at levelCap

  // ── Spawn distance band (blocks from player) ───────────────────────────
  // maxRange is fixed; minRange shrinks so high-level packs can spawn closer.
  maxRange: 12,         // outer radius (always)
  minRangeAt0: 3.5,     // inner radius at level 0 (keeps distance)
  minRangeAtMax: 0.8,   // inner radius at levelCap (almost on top)

  // ── Placement attempts per wave ────────────────────────────────────────
  // More tries at high level so denser / closer spawns still succeed on
  // sparse valid surfaces (obsidian / nether brick only).
  attemptsAt0: 10,      // random ground probes at level 0
  attemptsAtMax: 16,    // random ground probes at levelCap
};

/** Blocks that are valid spawn surfaces */
export const VALID_SPAWN_BLOCKS = new Set([
  "minecraft:obsidian",
  "minecraft:nether_brick",
  "minecraft:nether_brick_stairs",
  "minecraft:nether_wart",
  "obsidian"
]);

export const DESTROYED_RIFT_MESSAGES = [
  "§7The path is gone, yet the longing remains.",
  "§7Some doors close so that the soul may learn to walk alone.",
  "§7What once bridged the infinite now rests in quiet absence.",
  "§7Memory is the only traveler that still crosses this threshold.",
  "§7The island waits in a silence no living voice can answer.",
  "§7All that remains is the shape of what was possible.",
  "§7A wound between worlds, healed by time and forgetting.",
  "§7The stars still remember the way, even if we no longer can.",
  "§7Nothing is truly lost... only sealed beyond reach.",
  "§7Echoes do not ask to be heard. They simply endure.",
  "§7The rift has returned to the dark from which it was torn.",
  "§7Journeys end. The longing for them does not.",
  "§7What connected us now teaches the art of distance.",
  "§7A doorway without a key is still a doorway in the mind.",
  "§7The other side no longer answers. Perhaps it never did.",
  "§7Ruins of light, scattered across the void.",
  "§7Every ending is a threshold we cannot cross twice.",
  "§7The silence between worlds has grown thick and final.",
  "§7Somewhere, a forgotten shore still listens for footsteps.",
  "§7The port has become a monument to what cannot return."
];