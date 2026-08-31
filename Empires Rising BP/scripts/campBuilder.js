import { system } from "@minecraft/server";
import { trackArea, untrackArea, makeTickingAreaName, getActiveAreaCount } from "./tickingAreaTracker.js";

// -------------------------------------------------------
// Config
// -------------------------------------------------------

const MIN_BUILD_Y = -64;
const MAX_BUILD_Y = 319;

const TERRAIN_SCAN_UP = 90;
const TERRAIN_SCAN_DOWN = 110;

const MAX_STRUCTURE_Y_DELTA = 20; // How much higher or lower a structure can spawn from the camps ceter Y

const MAX_LOAD_WAIT_TICKS = 200;   // How long to wait for a chunk to load when creating a TA
const COMMANDS_PER_TICK = 220;

const DEFOREST_PAD = 3;
const TOWER_MAX_FOOTPRINT = 15;

const WALL_TOWER_OUTSET = 3; // blocks outside the wall perimeter
const TOWER_NEGATIVE_Y_ALLOWANCE = 25 // how much the outside towers can go under the interior platform

const INTERIOR_PILLAR_SPACING = 10; // blocks between interior platform edge pillars

const STRUCTURE_SURROUND_FILL_HEIGHT = 10; // how many blocks above structure Y to fill around it
const STRUCTURE_SURROUND_BLOCK = "minecraft:deepslate_bricks"; // block used for the surround fill

const WALL_BLOCK = "minecraft:deepslate_tiles";
const WALL_CAP_BLOCK = "minecraft:chiseled_deepslate";
const INTERIOR_PLATFORM_BLOCK = "minecraft:deepslate_bricks";
const DEFAULT_SUPPORT_BLOCK = "minecraft:deepslate_bricks";
const FOUNDATION_PILLAR_BLOCK = "minecraft:chiseled_deepslate";

const GATE_STRUCTURE_ID = "subo:gate"; // change if your .mcstructure has a different name/namespace
const GATE_WIDTH = 4;   // along the wall
const GATE_DEPTH = 1;   // through the wall

// How many gates to place (sides chosen randomly)
const GATE_COUNT = {
    very_small: 1,
    small: 1,
    medium: 2,
    big: 2,
    very_big: 3,
    huge: 4,
};

const MAX_TICKING_AREAS = 6;
const MAX_TA_SLOTS_PER_BUILD = 3;
const MAX_CONCURRENT_BUILDS = 3;

// Rectangle camps are this fraction as deep (Z) as they are wide (X),
// with a hard minimum depth so tiny camps still fit structures.
const RECT_DEPTH_RATIO = 0.68;
const RECT_MIN_DEPTH = 13;

const WALL_LAYER_SPACING = 1; // Block gap between consecutive wall rings

// How many wall rings each camp size gets (innermost = ring 0, outermost = ring N-1).
// Rings are spaced WALL_LAYER_SPACING blocks apart (center-to-center radius difference).
const WALL_LAYER_COUNT = {
    very_small: 1,
    small: 1,
    medium: 2,
    big: 2,
    very_big: 3,
    huge: 3,
};

// Safe guaranteed-max inclusive block spans that never overflow the 100-chunk
// limit regardless of where the camp center falls on the chunk grid.
// We use the tighter but still guaranteed-safe values below.
const TA_SAFE_MAX_SPAN = [
    { strips: 1, maxSpan: 145 },
    { strips: 2, maxSpan: 193 },
    { strips: 3, maxSpan: 241 },
];


// -------------------------------------------------------
// Global build concurrency gate
// -------------------------------------------------------

let _activeBuildCount = 0;

/**
 * Waits (polling every tick) until both conditions are true:
 *   1. Fewer than MAX_CONCURRENT_BUILDS camps are currently building.
 *   2. There are enough free TA slots for the requested amount.
 * This prevents ever exceeding the MCBE ticking area hard limit of 10.
 */
async function waitForBuildSlot(requiredSlots = MAX_TA_SLOTS_PER_BUILD) {
    while (
        _activeBuildCount >= MAX_CONCURRENT_BUILDS ||
        getActiveAreaCount() + requiredSlots > MAX_TICKING_AREAS
    ) {
        await nextTick();
    }
    _activeBuildCount++;
}

function releaseBuildSlot() {
    _activeBuildCount = Math.max(0, _activeBuildCount - 1);
}

// -------------------------------------------------------
// Style system
// -------------------------------------------------------
/**
 * tiny:   3x5 to 6x6
 * small:  8x7 to 14x12
 * medium: 12x11 to 27x27
 * large:  15x19 to 32x32   (footprint ≤ 32)
 * huge:   36x36 to 45x45   (footprint ≥ 36, formerly oversized "large")
 * tower:  7x7 to 15x15
 *
 * The script assumes structure origin is lower north-west corner.
 * 
 * Structure ID format: subo:camp_<style>_<size>_<index>_<W>x<H>x<D>
 *
 * Styles:
 *   generic   — wood/stone, fits any biome (always mixed in)
 *   samurai   — dark oak, paper walls, pagoda roofs
 *   clay      — terracotta, adobe, warm desert/badlands
 *   ice       — packed ice, blue glass, frozen tundra
 *   jungle    — mossy stone, vines, open platforms
 *   nether    — nether brick, blackstone, crimson/warped
 *   end       — purpur, end stone, chorus
 *   swamp     — mud brick, dark wood, lanterns
 *
 * Size slots: tiny | small | medium | large | huge | tower
 * tower_big  = height > 15  (type 2 spots)
 * tower_small= height ≤ 15  (type 1 spots)
 * FIX COMMENT AFTER NEW LAYOUT
 */

const STYLE_POOLS = {
    generic: {
        tiny: [

            { id: "subo:camp_generic_tiny_10_n_7x7", w: 7, d: 7, face: "n" },
            { id: "subo:camp_generic_tiny_11_n_8x8", w: 8, d: 8, face: "n" },
            { id: "subo:camp_generic_tiny_12_n_7x7", w: 7, d: 7, face: "n" },
            { id: "subo:camp_generic_tiny_13_n_7x7", w: 7, d: 7, face: "n" },
            { id: "subo:camp_generic_tiny_14_n_10x10", w: 10, d: 10, face: "n" },
            { id: "subo:camp_generic_tiny_15_n_9x9", w: 9, d: 9, face: "n" },
            { id: "subo:camp_generic_tiny_16_n_6x7", w: 6, d: 7, face: "n" },
            { id: "subo:camp_generic_tiny_1_n_7x7", w: 7, d: 7, face: "n" },
            { id: "subo:camp_generic_tiny_2_e_5x7", w: 5, d: 7, face: "e" },
            { id: "subo:camp_generic_tiny_3_n_7x7", w: 7, d: 7, face: "n" },
            { id: "subo:camp_generic_tiny_4_s_8x6", w: 8, d: 6, face: "s" },
            { id: "subo:camp_generic_tiny_5_e_5x6", w: 5, d: 6, face: "e" },
            { id: "subo:camp_generic_tiny_6_n_9x9", w: 9, d: 9, face: "n" },
            { id: "subo:camp_generic_tiny_7_n_7x7", w: 7, d: 7, face: "n" },
            { id: "subo:camp_generic_tiny_8_n_8x8", w: 8, d: 8, face: "n" },
            { id: "subo:camp_generic_tiny_9_n_9x10", w: 9, d: 10, face: "n" },
        ],
        small: [
            { id: "subo:camp_generic_small_1_w_13x15", w: 13, d: 15, face: "w" },
            { id: "subo:camp_generic_small_2_s_13x11", w: 13, d: 11, face: "s" },
            { id: "subo:camp_generic_small_3_s_14x15", w: 14, d: 15, face: "s" },
            { id: "subo:camp_generic_small_4_s_13x14", w: 13, d: 14, face: "s" },
            { id: "subo:camp_generic_small_5_n_10x13", w: 10, d: 13, face: "n" },
            { id: "subo:camp_generic_small_6_w_15x15", w: 15, d: 15, face: "w" },
        ],
        medium: [
            { id: "subo:camp_generic_medium_10_n_18x25", w: 18, d: 25, face: "n" },
            { id: "subo:camp_generic_medium_11_e_19x17", w: 19, d: 17, face: "e" },
            { id: "subo:camp_generic_medium_12_w_17x14", w: 17, d: 14, face: "w" },
            { id: "subo:camp_generic_medium_13_n_22x24", w: 22, d: 24, face: "n" },
            { id: "subo:camp_generic_medium_14_s_14x19", w: 14, d: 19, face: "s" },
            { id: "subo:camp_generic_medium_15_e_25x25", w: 25, d: 25, face: "e" },
            { id: "subo:camp_generic_medium_16_e_22x23", w: 22, d: 23, face: "e" },
            { id: "subo:camp_generic_medium_17_e_20x22", w: 20, d: 22, face: "e" },
            { id: "subo:camp_generic_medium_18_n_12x20", w: 12, d: 20, face: "n" },
            { id: "subo:camp_generic_medium_19_n_14x24", w: 14, d: 24, face: "n" },
            { id: "subo:camp_generic_medium_1_n_21x25", w: 21, d: 25, face: "n" },
            { id: "subo:camp_generic_medium_20_n_13x22", w: 13, d: 22, face: "n" },
            { id: "subo:camp_generic_medium_21_e_19x17", w: 19, d: 17, face: "e" },
            { id: "subo:camp_generic_medium_2_e_19x17", w: 19, d: 17, face: "e" },
            { id: "subo:camp_generic_medium_3_w_21x21", w: 21, d: 21, face: "w" },
            { id: "subo:camp_generic_medium_4_e_24x24", w: 24, d: 24, face: "e" },
            { id: "subo:camp_generic_medium_5_s_21x20", w: 21, d: 20, face: "s" },
            { id: "subo:camp_generic_medium_6_s_19x25", w: 19, d: 25, face: "s" },
            { id: "subo:camp_generic_medium_7_s_22x11", w: 22, d: 11, face: "s" },
            { id: "subo:camp_generic_medium_8_e_18x17", w: 18, d: 17, face: "e" },
            { id: "subo:camp_generic_medium_9_w_12x18", w: 12, d: 18, face: "w" },
        ],
        big: [
            { id: "subo:camp_generic_big_1_s_28x24", w: 28, d: 24, face: "s" },
            { id: "subo:camp_generic_big_2_n_34x35", w: 34, d: 35, face: "n" },
            { id: "subo:camp_generic_big_3_n_30x21", w: 30, d: 21, face: "n" },
            { id: "subo:camp_generic_big_4_n_27x26", w: 27, d: 26, face: "n" },
            { id: "subo:camp_generic_big_5_e_23x27", w: 23, d: 27, face: "e" },
            { id: "subo:camp_generic_big_6_s_22x34", w: 22, d: 34, face: "s" },
            { id: "subo:camp_generic_big_7_w_18x32", w: 18, d: 32, face: "w" },
            { id: "subo:camp_generic_big_8_n_25x38", w: 25, d: 38, face: "n" },
            { id: "subo:camp_generic_big_9_w_23x42", w: 23, d: 42, face: "w" },
        ],
        boss: [
            { id: "subo:camp_generic_boss_1_w_30x30", w: 30, d: 30, face: "w" },
            { id: "subo:camp_generic_boss_2_n_35x50", w: 35, d: 50, face: "n" },
        ],
        tower: [
            { id: "subo:camp_generic_tower_1_s_15x15", w: 15, d: 15, face: "s" },
            { id: "subo:camp_generic_tower_2_e_11x11", w: 11, d: 11, face: "e" },
            { id: "subo:camp_generic_tower_7_e_15x15", w: 15, d: 15, face: "e" },
            { id: "subo:camp_generic_tower_8_e_15x15", w: 15, d: 15, face: "e" },
        ],
        small_tower: [
            { id: "subo:camp_generic_small_tower_3_w_9x9", w: 9, d: 9, face: "w" },
            { id: "subo:camp_generic_small_tower_4_e_8x7", w: 8, d: 7, face: "e" },
            { id: "subo:camp_generic_small_tower_5_e_9x9", w: 9, d: 9, face: "e" },
            { id: "subo:camp_generic_small_tower_6_e_9x9", w: 9, d: 9, face: "e" },
            { id: "subo:camp_generic_small_tower_9_w_9x9", w: 9, d: 9, face: "w" },]
    },

    wooden: {
        tiny: [
        ],
        small: [
        ],
        medium: [
        ],
        big: [
        ],
        boss: [
        ],
        tower: [
        ],
        small_tower: [
        ],
    },

    stone: {
        tiny: [
        ],
        small: [
        ],
        medium: [
        ],
        big: [
        ],
        boss: [
        ],
        tower: [
        ],
        small_tower: [
        ],
    },

    samurai: {
        tiny: [
            { id: "subo:camp_samurai_tiny_1_s_9x11", w: 9, d: 11, face: "s" },
        ],
        small: [
        ],
        medium: [
        ],
        big: [
        ],
        boss: [
        ],
        tower: [
        ],
        small_tower: [
        ],
    },

    clay: {
        tiny: [],
        small: [
            { id: "subo:camp_clay_small_1_w_15x13", w: 15, d: 13, face: "w" },
            { id: "subo:camp_clay_small_2_w_15x15", w: 15, d: 15, face: "w" },
            { id: "subo:camp_clay_small_3_n_15x15", w: 15, d: 15, face: "n" },
            { id: "subo:camp_clay_small_4_w_15x14", w: 15, d: 14, face: "w" },
        ],
        medium: [{ id: "subo:camp_clay_medium_1_w_17x14", w: 17, d: 14, face: "w" },
        ],
        big: [],
        boss: [],
        tower: [
        ],
        small_tower: [
        ],
    },

    ice: {
        tiny: [
        ],
        small: [
        ],
        medium: [
        ],
        big: [
        ],
        boss: [
        ],
        tower: [
        ],
        small_tower: [
        ],
    },

    desert: {
        tiny: [
        ],
        small: [
        ],
        medium: [
        ],
        big: [
        ],
        boss: [
        ],
        tower: [
        ],
        small_tower: [
        ],
    },

};

/**
 * Biome keyword → preferred style key.
 * First match wins. Falls through to weighted random if no match.
 */
const BIOME_STYLE_MAP = [
    { match: ["cherry", "flower"], style: "samurai" },
    { match: ["frozen", "ice", "snowy"], style: "ice" },
    { match: ["badlands", "mesa", "savanna"], style: "clay" },
    { match: ["jungle"], style: "jungle" },
    { match: ["swamp", "mangrove"], style: "swamp" },
    { match: ["desert"], style: "desert" },
];

/**
 * Weight for each style when chosen randomly (no biome match).
 * Higher = more common.
 */
const STYLE_WEIGHTS = {
    generic: 40,
    samurai: 2,
    clay: 2,
    ice: 0,
    jungle: 0,
    swamp: 0,
};

const CAMP_SIZES = [
    { key: "very_small", label: "Very Small Outpost", diameter: 27, wallHeight: 4, towerSpacing: 28, supportRadius: 1, weight: 1 },
    { key: "small", label: "Small Camp", diameter: 39, wallHeight: 5, towerSpacing: 29, supportRadius: 1, weight: 1 },
    { key: "medium", label: "Medium Camp", diameter: 69, wallHeight: 6, towerSpacing: 30, supportRadius: 2, weight: 10 },
    { key: "big", label: "Big Camp", diameter: 99, wallHeight: 7, towerSpacing: 30, supportRadius: 3, weight: 10 },
    { key: "very_big", label: "Very Big Camp", diameter: 135, wallHeight: 8, towerSpacing: 31, supportRadius: 3, weight: 25 },
    { key: "huge", label: "Huge Settlement", diameter: 205, wallHeight: 10, towerSpacing: 31, supportRadius: 4, weight: 18 },
];

const CAMP_SHAPES = [
    { key: "square", label: "Square", weight: 1.15 },
    { key: "rectangle", label: " ", weight: 1.0 },
    { key: "circle", label: "Circle", weight: 0.9 },
];

// Multiple possible required layouts per size.
// One of them is chosen randomly for every camp.
const REQUIRED_STRUCTURES = {
    // diameter 27  (radius ≈ 13.5)
    very_small: [
        // single small in the centre
        [
            { x: 0, z: 0, pool: "small", required: true },
        ],
        // single tower in the centre
        [
            { x: 0, z: 0, pool: "tower", required: true },
        ],
        // two tinies 
        [
            { x: 5, z: 3, pool: "tiny", required: true },
            { x: -5, z: -3, pool: "tiny", required: true },
        ]
    ],

    // diameter 39  (radius ≈ 19.5)
    small: [
        // single small in the centre
        [
            { x: 0, z: 0, pool: "small", required: true },
        ],
        // centre small + two tinies
        [
            { x: 0, z: 0, pool: "small", required: true },
            { x: 11, z: 6, pool: "tiny", required: true },
            { x: -11, z: -6, pool: "tiny", required: true },
        ],
        // small + two tinies
        [
            { x: 0, z: 8, pool: "small", required: true },
            { x: 8, z: -5, pool: "tiny", required: true },
            { x: -8, z: -5, pool: "tiny", required: true },
        ],
    ],

    // diameter 69  (radius ≈ 34.5)
    medium: [
        // single medium in the centre
        [
            { x: 0, z: 0, pool: "medium", required: true },
        ],
        // centre medium + two smalls
        [
            { x: 0, z: 0, pool: "medium", required: true },
            { x: 18, z: 0, pool: "small", required: true },
            { x: -18, z: 0, pool: "small", required: true },
        ],
        // centre medium + four tinies
        [
            { x: 0, z: 0, pool: "medium", required: true },
            { x: 14, z: 14, pool: "tiny", required: true },
            { x: -14, z: 14, pool: "tiny", required: true },
            { x: -14, z: -14, pool: "tiny", required: true },
            { x: 14, z: -14, pool: "tiny", required: true },
        ],
    ],

    // diameter 99  (radius ≈ 49.5)
    big: [
        // single big in the centre
        [
            { x: 0, z: 0, pool: "big", required: true },
        ],
        // centre big + two mediums
        [
            { x: 0, z: 0, pool: "big", required: true },
            { x: 26, z: 0, pool: "medium", required: true },
            { x: -26, z: 0, pool: "medium", required: true },
        ],
        // centre big + four smalls
        [
            { x: 0, z: 0, pool: "big", required: true },
            { x: 22, z: 18, pool: "small", required: true },
            { x: -22, z: 18, pool: "small", required: true },
            { x: -22, z: -18, pool: "small", required: true },
            { x: 22, z: -18, pool: "small", required: true },
        ],
    ],

    // diameter 135  (radius ≈ 67.5)
    very_big: [
        // single boss in the centre
        [
            { x: 0, z: 0, pool: "boss", required: true },
        ],
        // centre boss + two bigs
        [
            { x: 0, z: 0, pool: "boss", required: true },
            { x: 34, z: 0, pool: "big", required: true },
            { x: -34, z: 0, pool: "big", required: true },
        ],
        // centre boss + four mediums
        [
            { x: 0, z: 0, pool: "boss", required: true },
            { x: 28, z: 24, pool: "medium", required: true },
            { x: -28, z: 24, pool: "medium", required: true },
            { x: -28, z: -24, pool: "medium", required: true },
            { x: 28, z: -24, pool: "medium", required: true },
        ],
    ],

    // diameter 205  (radius ≈ 102.5)
    huge: [
        // single boss in the centre
        [
            { x: 0, z: 0, pool: "boss", required: true },
        ],
        // centre boss + two bigs on the long axis
        [
            { x: 0, z: 0, pool: "boss", required: true },
            { x: 48, z: 0, pool: "big", required: true },
            { x: -48, z: 0, pool: "big", required: true },
        ],
        // centre boss + four mediums
        [
            { x: 0, z: 0, pool: "boss", required: true },
            { x: 40, z: 32, pool: "medium", required: true },
            { x: -40, z: 32, pool: "medium", required: true },
            { x: -40, z: -32, pool: "medium", required: true },
            { x: 40, z: -32, pool: "medium", required: true },
        ],
        // centre boss + two bigs + two mediums
        [
            { x: 0, z: 0, pool: "boss", required: true },
            { x: 50, z: 0, pool: "big", required: true },
            { x: -50, z: 0, pool: "big", required: true },
            { x: 0, z: 38, pool: "medium", required: true },
            { x: 0, z: -38, pool: "medium", required: true },
        ],
    ],
};

// How many extra (non-required) buildings to try to place, by camp size.
const EXTRA_STRUCTURE_ATTEMPTS = {
    very_small: 2,
    small: 6,
    medium: 15,
    big: 24,
    very_big: 33,
    huge: 40,
};

// Minimum clearance from the inner face of the outermost wall.
const WALL_CLEARANCE = 4;          // base distance from wall
const CORNER_EXTRA_CLEARANCE = 2;  // extra padding in corners (rect/square only)
const STRUCTURE_GAP = 2;                 // minimum XZ gap between structure footprints
const MAX_STRUCTURE_CORNER_DROP = 7;     // max allowed drop from structure base Y to solid ground at every corner

// Extra structures only; boss is intentionally not included.
const EXTRA_POOL_CANDIDATES = {
    very_small: ["small", "tower", "tiny", "small_tower"],
    small: ["small", "tower", "tiny", "small_tower"],
    medium: ["medium", "small", "tower", "tiny", "small_tower"],
    big: ["big", "medium", "small", "tower", "tiny", "small_tower"],
    very_big: ["big", "medium", "small", "tower", "tiny", "small_tower"],
    huge: ["big", "medium", "small", "tower", "tiny", "small_tower"],
};

const EXTRA_POOL_WEIGHTS = {
    big: 10,
    medium: 7,
    small: 3,
    tower: 2,
    tiny: 1,
    small_tower: 1,
};

// -------------------------------------------------------
// Small helpers
// -------------------------------------------------------

const nextTick = () => new Promise(resolve => system.run(resolve));
const now = () => Date.now();

let commandBudget = 0;

function createPoolQueues(activePools) {
    const queues = {};
    for (const [key, pool] of Object.entries(activePools)) {
        queues[key] = { remaining: [...pool].sort(() => Math.random() - 0.5), used: [] };
    }
    return queues;
}

function drawFromQueue(queues, poolKey) {
    const q = queues[poolKey];
    if (!q || (q.remaining.length === 0 && q.used.length === 0)) return null;

    if (q.remaining.length === 0) {
        // All used up — reshuffle and start again
        q.remaining = [...q.used].sort(() => Math.random() - 0.5);
        q.used = [];
    }

    const picked = q.remaining.pop();
    q.used.push(picked);
    return picked;
}

function int(n) {
    return Math.floor(n);
}

function clampY(y) {
    return Math.max(MIN_BUILD_Y, Math.min(MAX_BUILD_Y, Math.floor(y)));
}

function key2(x, z) {
    return `${int(x)},${int(z)}`;
}

function dist2D(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
}

function makeOdd(n) {
    n = Math.max(1, Math.round(n));
    return n % 2 === 1 ? n : n + 1;
}

function randomFromArray(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

// Bedrock structure rotation convention, assuming:
//   0_degrees   = exported structure's original orientation
//   90_degrees  = original front rotates south -> west
//   180_degrees = original front rotates south -> north
//   270_degrees = original front rotates south -> east
const FACE_TO_DEGREES = {
    s: 0,
    w: 90,
    n: 180,
    e: 270,
};

const DEGREES_TO_ROTATION = {
    0: "0_degrees",
    90: "90_degrees",
    180: "180_degrees",
    270: "270_degrees",
};

/**
 * Returns the structure-load rotation needed to make the structure's front
 * face from its placement spot toward the camp center.
 *
 * `savedFacing` is the front direction of the structure in its exported file.
 */
function rotationTowardCampCenter(
    structureX,
    structureZ,
    campCenterX,
    campCenterZ,
    savedFacing = "s"
) {
    const dx = campCenterX - structureX;
    const dz = campCenterZ - structureZ;

    // A structure directly at the camp center has no meaningful direction.
    // Keep its exported orientation in that special case.
    if (dx === 0 && dz === 0) {
        return "0_degrees";
    }

    let desiredFacingDegrees;

    // Choose the cardinal direction that is closest to the center.
    if (Math.abs(dx) >= Math.abs(dz)) {
        // Camp center is primarily east or west of this structure.
        desiredFacingDegrees = dx > 0 ? 270 : 90;
    } else {
        // Camp center is primarily south or north of this structure.
        desiredFacingDegrees = dz > 0 ? 0 : 180;
    }

    const exportedFacingDegrees = FACE_TO_DEGREES[savedFacing] ?? 0;

    // Rotate from the structure's exported front direction to its desired front direction.
    const rotationDegrees =
        (desiredFacingDegrees - exportedFacingDegrees + 360) % 360;

    return DEGREES_TO_ROTATION[rotationDegrees];
}

async function budgetYield() {
    commandBudget++;
    if (commandBudget >= COMMANDS_PER_TICK) {
        commandBudget = 0;
        await nextTick();
    }
}

// Returns the XZ footprint after applying a structure rotation.
// 90/270 degrees swaps width <-> depth.
function getRotatedFootprint(width, depth, rotation) {
    if (rotation === "90_degrees" || rotation === "270_degrees") {
        return { fw: depth, fd: width };
    }
    return { fw: width, fd: depth };
}

function getCenteredFootprintBox(cx, cz, fw, fd, pad = 0) {
    const halfWNeg = Math.floor(fw / 2);
    const halfWPos = fw - 1 - halfWNeg;
    const halfDNeg = Math.floor(fd / 2);
    const halfDPos = fd - 1 - halfDNeg;

    return {
        minX: int(cx - halfWNeg - pad),
        maxX: int(cx + halfWPos + pad),
        minZ: int(cz - halfDNeg - pad),
        maxZ: int(cz + halfDPos + pad),
    };
}

function boxesOverlap(a, b, gap = 0) {
    return (
        a.minX <= b.maxX + gap &&
        a.maxX >= b.minX - gap &&
        a.minZ <= b.maxZ + gap &&
        a.maxZ >= b.minZ - gap
    );
}

/**
 * Pushes a required structure straight outward from the camp center (along
 * its own placement vector) until its real footprint box no longer overlaps
 * any structure already accepted for this layout (with STRUCTURE_GAP
 * clearance). This is what actually guarantees required structures never
 * overlap each other or the center/boss building, regardless of which
 * random variant (and therefore real width/depth) got picked for either
 * structure — instead of just rejecting the whole layout the instant a
 * fixed-offset collision shows up.
 *
 * Since the push happens along the exact same direction from the camp
 * center, the structure's "face toward center" rotation stays correct —
 * only its distance from the center increases.
 */
function resolveRequiredOverlapByPushingOut(plan, x, z, fw, fd, testPlaced, maxPushBlocks = 300) {
    let curX = x;
    let curZ = z;
    let box = getCenteredFootprintBox(curX, curZ, fw, fd);

    let overlapping = testPlaced.some(p => boxesOverlap(box, p.box, STRUCTURE_GAP));
    if (!overlapping) {
        return { x: curX, z: curZ, box, resolved: true };
    }

    // Direction to push: straight away from the camp center. If the
    // structure is exactly at the center (no direction), push along +X.
    let dx = x - plan.center.x;
    let dz = z - plan.center.z;
    let len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.0001) { dx = 1; dz = 0; len = 1; }
    const ux = dx / len;
    const uz = dz / len;

    for (let step = 1; step <= maxPushBlocks; step++) {
        curX = int(x + ux * step);
        curZ = int(z + uz * step);
        box = getCenteredFootprintBox(curX, curZ, fw, fd);

        overlapping = testPlaced.some(p => boxesOverlap(box, p.box, STRUCTURE_GAP));
        if (!overlapping) {
            return { x: curX, z: curZ, box, resolved: true };
        }
    }

    return { x: curX, z: curZ, box, resolved: false };
}

function weightedRandomPool(poolKeys) {
    const candidates = poolKeys
        .map(key => ({ key, weight: Math.max(0, EXTRA_POOL_WEIGHTS[key] ?? 1) }))
        .filter(p => p.weight > 0);

    const total = candidates.reduce((sum, p) => sum + p.weight, 0);
    if (total <= 0) return randomFromArray(poolKeys);

    let roll = Math.random() * total;
    for (const p of candidates) {
        roll -= p.weight;
        if (roll <= 0) return p.key;
    }

    return candidates[candidates.length - 1].key;
}

function pickStructureForPlanning(activePools, poolKey) {
    return randomFromArray(activePools?.[poolKey] ?? []);
}

function getStructureSpotMetrics(plan, poolKey, x, z, picked) {
    if (!picked) return null;

    const rotation = rotationTowardCampCenter(
        x,
        z,
        plan.center.x,
        plan.center.z,
        picked.face
    );

    const { fw, fd } = getRotatedFootprint(picked.width, picked.depth, rotation);
    const half = Math.ceil(Math.max(fw, fd) / 2);
    const box = getCenteredFootprintBox(x, z, fw, fd);

    return { picked, rotation, fw, fd, half, box };
}

function isSolidSurfaceBlock(block) {
    const typeId = block?.typeId ?? "minecraft:air";

    if (isAirType(typeId)) return false;
    if (isLiquidType(typeId)) return false;
    if (isLeavesType(typeId)) return false;
    if (isLogType(typeId)) return false;

    return block?.isLiquidBlocking("Water") === true;
}

function hasSolidSurfaceWithinDrop(dimension, x, baseY, z, maxDrop = MAX_STRUCTURE_CORNER_DROP) {
    const startY = clampY(baseY - 1);
    const endY = clampY(baseY - maxDrop);

    for (let y = startY; y >= endY; y--) {
        const block = getBlockSafe(dimension, x, y, z);
        if (isSolidSurfaceBlock(block)) return true;
    }

    return false;
}

function structureCornersHaveSupport(dimension, cx, baseY, cz, fw, fd) {
    const box = getCenteredFootprintBox(cx, cz, fw, fd);

    const corners = [
        { x: box.minX, z: box.minZ },
        { x: box.maxX, z: box.minZ },
        { x: box.minX, z: box.maxZ },
        { x: box.maxX, z: box.maxZ },
    ];

    for (const corner of corners) {
        if (!hasSolidSurfaceWithinDrop(dimension, corner.x, baseY, corner.z)) {
            return {
                ok: false,
                x: corner.x,
                z: corner.z,
                reason: "corner_too_high_above_solid_surface",
            };
        }
    }

    return { ok: true };
}

// Drops a support pillar straight down from topY-1 until it hits a
// non-air / non-liquid block (or the build floor).
// Returns the lowest Y that actually got a block placed (the pillar's bottom),
// so callers can know how deep this particular pillar had to go.
async function placePillarDown(dimension, x, topY, z, logType) {
    let bottomY = topY - 1;
    for (let y = topY - 1; y >= MIN_BUILD_Y; y--) {
        const block = dimension.getBlock({ x: x, y: y, z: z });
        if (block?.isLiquidBlocking("Water")) { // this ignores any grass, kelp, water, air...
            bottomY = y + 1;
            break;
        }
        await setBlock(dimension, x, y, z, logType);
        bottomY = y;
    }
    return bottomY;
}

async function fillAroundStructure(dimension, x, baseY, z, fw, fd) {
    const halfW_neg = Math.floor(fw / 2);
    const halfW_pos = fw - 1 - halfW_neg;
    const halfD_neg = Math.floor(fd / 2);
    const halfD_pos = fd - 1 - halfD_neg;

    const minX = x - halfW_neg - 1;
    const maxX = x + halfW_pos + 1;
    const minZ = z - halfD_neg - 1;
    const maxZ = z + halfD_pos + 1;

    const fillY1 = clampY(baseY);
    const fillY2 = clampY(baseY + STRUCTURE_SURROUND_FILL_HEIGHT);

    const replaceTargets = [
        "minecraft:water", "minecraft:lava",
        "minecraft:stone", "minecraft:dirt", "minecraft:grass_block",
        "minecraft:sand", "minecraft:gravel", "minecraft:mud",
        "minecraft:sandstone", "minecraft:snow", "minecraft:ice",
        "minecraft:packed_ice", "minecraft:blue_ice",
        "minecraft:diorite", "minecraft:granite", "minecraft:andesite",
    ];

    for (const target of replaceTargets) {
        dimension.runCommand(
            `fill ${minX} ${fillY1} ${minZ} ${maxX} ${fillY2} ${maxZ} ${STRUCTURE_SURROUND_BLOCK} replace ${target}`
        );
        await budgetYield();
    }
}

/**
 * Returns true if a vanilla villager exists within the given radius of (cx, cy, cz).
 * Uses a single entity query — no looping, very fast.
 */
function isVillageNearby(dimension, cx, cy, cz, radius) {
    const entities = dimension.getEntities({
        type: "minecraft:villager",
        location: { x: cx, y: cy, z: cz },
        maxDistance: radius,
    });
    return entities.length > 0;
}

function getInteriorBounds(plan) {
    // Still useful for the initial random sampling box
    const { halfW, halfD } = getPlanHalfExtents(plan, -WALL_CLEARANCE);
    return {
        minX: plan.center.x - halfW,
        maxX: plan.center.x + halfW,
        minZ: plan.center.z - halfD,
        maxZ: plan.center.z + halfD,
        // Extra info for circle checks
        radius: Math.floor(plan.size.diameter / 2) - WALL_CLEARANCE,
    };
}

/** Returns true if a building of the given half-size can sit at (x,z) */
function isInsideSafeArea(plan, x, z, half) {
    if (plan.shape.key === "circle") {
        // True radial clearance
        const dist = dist2D(x, z, plan.center.x, plan.center.z);
        return dist + half <= (Math.floor(plan.size.diameter / 2) - WALL_CLEARANCE);
    }

    // Rectangle / square – axis-aligned + corner tightening
    const bounds = getInteriorBounds(plan);
    const distToWallX = Math.min(x - bounds.minX, bounds.maxX - x);
    const distToWallZ = Math.min(z - bounds.minZ, bounds.maxZ - z);

    if (distToWallX < half || distToWallZ < half) return false;

    // Stronger rejection near corners
    if (distToWallX < half + CORNER_EXTRA_CLEARANCE &&
        distToWallZ < half + CORNER_EXTRA_CLEARANCE) {
        return false;
    }
    return true;
}

/**
 * Returns true if any player is within `radius` of (cx, cy, cz).
 * Uses a single query — cheap.
 */
function isPlayerNearby(dimension, cx, cy, cz, radius = 500) {
    // return false;  // for testing prpss
    try {
        const players = dimension.getPlayers({
            location: { x: cx, y: cy, z: cz },
            maxDistance: radius,
        });
        return players.length > 0;
    } catch {
        return false; // safer to continue than to hard-fail on API edge cases
    }
}

// -------------------------------------------------------
// Ticking area helpers
// -------------------------------------------------------

function isLocationLoaded(dimension, x, y, z) {
    try {
        // Preferred (1.21+): explicit chunk check
        if (typeof dimension.isChunkLoaded === "function") {
            return dimension.isChunkLoaded({ x: int(x), y: clampY(y), z: int(z) });
        }
        // Fallback
        console.warn("FALLBACK TO OLD getBlock LOAD CHECK!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");

        const block = dimension.getBlock({ x: int(x), y: clampY(y), z: int(z) });
        return !!block && (block.isValid !== false);
    } catch {
        return false;
    }
}

function removeTickingArea(dimension, nameOrNames) {
    const names = Array.isArray(nameOrNames) ? nameOrNames : [nameOrNames];
    for (const name of names) {
        try {
            dimension.runCommand(`tickingarea remove ${name}`);
            untrackArea(name);
        } catch { }
    }
}


// Split into 3 horizontal Z-strips, check corners of each strip:
/**
 * Waits until ALL of the given probe points are loaded.
 * Resolves true if all loaded within maxChecks ticks, false on timeout.
 */
const waitUntilAllLoaded = (dimension, probes, maxChecks = MAX_LOAD_WAIT_TICKS) =>
    new Promise(resolve => {
        let checks = 0;
        const runId = system.runInterval(() => {
            checks++;
            const allLoaded = probes.every(p => isLocationLoaded(dimension, p.x, p.y, p.z));
            if (allLoaded) {
                system.clearRun(runId);
                resolve(true);
                return;
            }
            if (checks >= maxChecks) {
                system.clearRun(runId);
                resolve(false);
            }
        }, 1);
    });

/**
 * Returns the required load span (inclusive block count) for a given camp size.
 * Accounts for wall radius + tower footprint overhang + deforestation padding.
 */
function getCampLoadSpan(sizeDef) {
    const reach = Math.floor(sizeDef.diameter / 2) + TOWER_MAX_FOOTPRINT + DEFOREST_PAD;
    return reach * 2 + 1;   // inclusive span
}

/**
 * Returns how many Z-strips are needed to keep each ticking area under
 * 100 chunks, given an inclusive block span.
 * Uses the guaranteed-safe thresholds from TA_SAFE_MAX_SPAN.
 * Returns null if the span is too large for even MAX_TA_SLOTS_PER_BUILD strips.
 */
function getRequiredStripCount(span) {
    for (const { strips, maxSpan } of TA_SAFE_MAX_SPAN) {
        if (span <= maxSpan) return strips;
    }

    return null;   // caller must fall back to a smaller camp
}

/**
 * Randomly picks a camp size using weighted random selection.
 */
function chooseRandomCampSize() {
    const total = CAMP_SIZES.reduce((sum, s) => sum + Math.max(0, s.weight ?? 0), 0);
    if (total <= 0) return randomFromArray(CAMP_SIZES);
    let roll = Math.random() * total;
    for (const size of CAMP_SIZES) {
        roll -= Math.max(0, size.weight ?? 0);
        if (roll <= 0) return size;
    }
    return CAMP_SIZES[CAMP_SIZES.length - 1];
}

/**
 * Returns all camp sizes with diameter <= the given size's diameter,
 * sorted biggest first (for fallback terrain validation).
 */
function getCandidateSizes(initialSizeDef) {
    return [...CAMP_SIZES]
        .filter(s => s.diameter <= initialSizeDef.diameter)
        .sort((a, b) => b.diameter - a.diameter);
}

/**
 * Creates 1, 2, or 3 ticking areas (Z-strips) to cover the given box.
 * stripCount must be 1, 2, or 3. Each strip is guaranteed ≤ 100 chunks
 *
 * Returns an array of TA name strings for later removal.
 */
async function addTickingArea(dimension, minX, minY, minZ, maxX, maxY, maxZ, baseName, stripCount = 1) {
    const totalZ = maxZ - minZ + 1;   // inclusive span
    const stripSpan = Math.ceil(totalZ / stripCount);
    const names = [];
    const strips = [];

    for (let i = 0; i < stripCount; i++) {
        const z0 = minZ + i * stripSpan;
        const z1 = Math.min(z0 + stripSpan - 1, maxZ);
        strips.push({ z0, z1 });
    }

    const centerX = int((minX + maxX) / 2);

    for (let i = 0; i < strips.length; i++) {
        const { z0, z1 } = strips[i];
        const centerZ = int((z0 + z1) / 2);
        const safeName = makeTickingAreaName(
            stripCount === 1 ? baseName : `${baseName}_s${i}`,
            centerX,
            centerZ
        );

        dimension.runCommand(
            `tickingarea add ${int(minX)} ${clampY(minY)} ${int(z0)} ` +
            `${int(maxX)} ${clampY(maxY)} ${int(z1)} ${safeName} true`
        );

        trackArea(safeName);
        names.push({ name: safeName, z0, z1 });
    }

    const probeY = clampY(minY + 30);          // mid-height of the TA box is safer
    const probes = [];

    // Corners of every strip
    for (const { z0, z1 } of strips) {
        probes.push({ x: int(minX), y: probeY, z: int(z0) });
        probes.push({ x: int(maxX), y: probeY, z: int(z0) });
        probes.push({ x: int(minX), y: probeY, z: int(z1) });
        probes.push({ x: int(maxX), y: probeY, z: int(z1) });
    }

    // Extra interior samples (grid) so the middle of large camps is also forced loaded
    const stepX = Math.max(16, Math.floor((maxX - minX) / 4));
    const stepZ = Math.max(16, Math.floor((maxZ - minZ) / 4));
    for (let x = minX; x <= maxX; x += stepX) {
        for (let z = minZ; z <= maxZ; z += stepZ) {
            probes.push({ x: int(x), y: probeY, z: int(z) });
        }
    }
    // Always include exact center
    probes.push({
        x: int((minX + maxX) / 2),
        y: probeY,
        z: int((minZ + maxZ) / 2),
    });

    const allLoaded = await waitUntilAllLoaded(dimension, probes, MAX_LOAD_WAIT_TICKS);

    if (!allLoaded) {
        console.warn(`[camp] TA probes timed out – continuing anyway (may cause partial builds)`);
    }

    // Extra settle ticks – terrain / lighting / liquid simulation need a moment
    // even after the chunk is “loaded”.
    for (let i = 0; i < 8; i++) await nextTick();

    return names.map(n => n.name);
}


// -------------------------------------------------------
// Block helpers
// -------------------------------------------------------

function isAirType(typeId) {
    return (
        typeId === "minecraft:air" ||
        typeId === "minecraft:cave_air" ||
        typeId === "minecraft:void_air"
    );
}

function isLiquidType(typeId) {
    return (
        typeId === "minecraft:water" ||
        typeId === "minecraft:lava" ||
        typeId === "minecraft:flowing_water" ||
        typeId === "minecraft:flowing_lava"
    );
}

function isLogType(typeId) {
    return (
        typeId.includes("_log") ||
        typeId.includes("_wood") ||
        typeId.includes("_stem") ||
        typeId.includes("_hyphae")
    );
}

function isLeavesType(typeId) {
    return typeId.includes("leaves") || typeId.includes("_leaf");
}

/**
 * Water/lava are intentionally NOT ignored.
 * Trees, leaves, grass, and flowers are ignored.
 */
function shouldIgnoreForTerrainTop(block) {
    const typeId = block?.typeId ?? "minecraft:air";
    if (isAirType(typeId)) return true;
    if (isLeavesType(typeId)) return true;
    if (isLogType(typeId)) return true;
    // Liquids must STOP the scan — never ignore them.
    if (isLiquidType(typeId)) return false;
    // Any remaining non-liquid block that doesn't block liquid flow is
    // passable vegetation/decoration (grass, ferns, flowers, snow_layer…).
    if (block && !block.isLiquidBlocking("Water")) return true;
    return false;
}

function getBlockSafe(dimension, x, y, z) {
    try {
        return dimension.getBlock({ x: int(x), y: clampY(y), z: int(z) });
    } catch {
        return null;
    }
}

function getBlockTypeSafe(dimension, x, y, z) {
    try {
        const block = dimension.getBlock({ x: int(x), y: clampY(y), z: int(z) });
        return block?.typeId ?? "minecraft:air";
    } catch {
        return "minecraft:air";
    }
}

async function setBlock(dimension, x, y, z, typeId) {
    dimension.runCommand(`setblock ${int(x)} ${clampY(y)} ${int(z)} ${typeId}`);
    await budgetYield();
}


// -------------------------------------------------------
// Geometry
// -------------------------------------------------------

function bresenhamLine(x0, z0, x1, z1) {
    x0 = int(x0);
    z0 = int(z0);
    x1 = int(x1);
    z1 = int(z1);

    const points = [];
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;

    let err = dx - dz;
    let x = x0;
    let z = z0;

    while (true) {
        points.push({ x, z });
        if (x === x1 && z === z1) break;

        const e2 = err * 2;

        if (e2 > -dz) {
            err -= dz;
            x += sx;
        }

        if (e2 < dx) {
            err += dx;
            z += sz;
        }
    }

    return points;
}

function uniquePoints(points) {
    const seen = new Set();
    const out = [];

    for (const p of points) {
        const x = int(p.x);
        const z = int(p.z);
        const k = key2(x, z);

        if (seen.has(k)) continue;

        seen.add(k);
        out.push({ x, z });
    }

    return out;
}

// Odd depth (in blocks) of a rectangle-shaped camp of the given diameter.
function rectangleDepth(diameter) {
    return makeOdd(Math.max(RECT_MIN_DEPTH, Math.round(diameter * RECT_DEPTH_RATIO)));
}

// Half-extents of a plan's footprint from its center.
//   r     = radius along X (always diameter/2)
//   halfW = half-width  (X) including optional pad
//   halfD = half-depth  (Z) including optional pad; rectangles are shallower
function getPlanHalfExtents(plan, pad = 0) {
    const r = Math.floor(plan.size.diameter / 2);
    const halfW = r + pad;
    const halfD = (plan.shape.key === "rectangle"
        ? Math.floor(rectangleDepth(plan.size.diameter) / 2)
        : r) + pad;
    return { r, halfW, halfD };
}

function generateSquareWall(cx, cz, diameter) {
    const r = Math.floor(diameter / 2);
    const points = [];

    // North side: left to right
    for (let x = cx - r; x <= cx + r; x++) points.push({ x, z: cz - r });
    // East side: top to bottom
    for (let z = cz - r + 1; z <= cz + r - 1; z++) points.push({ x: cx + r, z });
    // South side: right to left
    for (let x = cx + r; x >= cx - r; x--) points.push({ x, z: cz + r });
    // West side: bottom to top
    for (let z = cz + r - 1; z >= cz - r + 1; z--) points.push({ x: cx - r, z });

    return uniquePoints(points);
}

function generateRectangleWall(cx, cz, diameter, layerIndex = 0) {
    const shrink = layerIndex * WALL_LAYER_SPACING;
    const halfW = Math.floor(diameter / 2) - shrink;
    const halfD = Math.floor(rectangleDepth(diameter) / 2) - shrink;
    if (halfW < 2 || halfD < 2) return [];
    const points = [];

    // North side: left to right
    for (let x = cx - halfW; x <= cx + halfW; x++) points.push({ x, z: cz - halfD });
    // East side: top to bottom
    for (let z = cz - halfD + 1; z <= cz + halfD - 1; z++) points.push({ x: cx + halfW, z });
    // South side: right to left
    for (let x = cx + halfW; x >= cx - halfW; x--) points.push({ x, z: cz + halfD });
    // West side: bottom to top
    for (let z = cz + halfD - 1; z >= cz - halfD + 1; z--) points.push({ x: cx - halfW, z });

    return uniquePoints(points);
}

function generateCircleWall(cx, cz, diameter) {
    const r = Math.floor(diameter / 2);
    const samples = Math.max(48, Math.ceil(2 * Math.PI * r * 1.6));
    const raw = [];

    for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        raw.push({
            x: Math.round(cx + Math.cos(a) * r),
            z: Math.round(cz + Math.sin(a) * r),
        });
    }

    const points = [];

    for (let i = 0; i < raw.length; i++) {
        const a = raw[i];
        const b = raw[(i + 1) % raw.length];
        points.push(...bresenhamLine(a.x, a.z, b.x, b.z));
    }

    return uniquePoints(points);
}

function generateWallPoints(shapeKey, cx, cz, diameter) {
    if (shapeKey === "square") return generateSquareWall(cx, cz, diameter);
    if (shapeKey === "rectangle") return generateRectangleWall(cx, cz, diameter);
    if (shapeKey === "circle") return generateCircleWall(cx, cz, diameter);
    return generateSquareWall(cx, cz, diameter);
}

// -------------------------------------------------------
// Structure spots
// -------------------------------------------------------

function generateStructureSpots(plan, activePools) {
    const spots = [];
    const placed = []; // { box }

    // ---- 1. Pick one required layout that actually fits using real picked structure sizes ----
    const layouts = REQUIRED_STRUCTURES[plan.size.key] ?? [[]];
    const shuffledLayouts = [...layouts].sort(() => Math.random() - 0.5);

    let acceptedRequired = null;

    for (const layout of shuffledLayouts) {
        const testSpots = [];
        const testPlaced = [];
        let layoutOk = true;

        for (const req of layout) {
            const absX = int(plan.center.x + req.x);
            const absZ = int(plan.center.z + req.z);

            const picked = pickStructureForPlanning(activePools, req.pool);
            const metrics = getStructureSpotMetrics(plan, req.pool, absX, absZ, picked);

            if (!metrics) {
                layoutOk = false;
                break;
            }

            // Instead of instantly discarding the whole layout on a collision,
            // push this structure straight outward from the camp center (away
            // from the boss/center building and any other required structure
            // already placed) until its real footprint clears them. This uses
            // the ACTUAL picked footprint (fw/fd), so it correctly accounts
            // for oversized boss variants (e.g. 35x50) as well as any large
            // "big"/"medium" companion structure.
            const resolved = resolveRequiredOverlapByPushingOut(
                plan, absX, absZ, metrics.fw, metrics.fd, testPlaced
            );

            if (!resolved.resolved) {
                layoutOk = false;
                break;
            }

            const finalX = resolved.x;
            const finalZ = resolved.z;
            const finalBox = resolved.box;

            if (!isInsideSafeArea(plan, finalX, finalZ, metrics.half)) {
                layoutOk = false;
                break;
            }

            testSpots.push({
                ...req,
                x: finalX,
                z: finalZ,
                picked: metrics.picked,
                rotation: metrics.rotation,
                fw: metrics.fw,
                fd: metrics.fd,
                foundationRadius: metrics.half,
                footprintBox: finalBox,
                index: testSpots.length,
            });

            testPlaced.push({ box: finalBox });
        }

        if (layoutOk) {
            acceptedRequired = { spots: testSpots, placed: testPlaced };
            break;
        }
    }

    if (!acceptedRequired) {
        console.warn(`[camp] No required layout fit for size=${plan.size.key} shape=${plan.shape.key}`);
        return [];
    }

    spots.push(...acceptedRequired.spots);
    placed.push(...acceptedRequired.placed);

    // ---- 2. Pack extra buildings, weighted toward bigger structures, but never boss ----
    const bounds = getInteriorBounds(plan);
    const maxExtra = EXTRA_STRUCTURE_ATTEMPTS[plan.size.key] ?? 3;

    const candidatePools = (EXTRA_POOL_CANDIDATES[plan.size.key] ?? ["medium", "small", "tiny", "tower", "small_tower"])
        .filter(p => p !== "boss")
        .filter(p => (activePools?.[p]?.length ?? 0) > 0);

    let extraPlaced = 0;
    const maxAttempts = maxExtra * 25;

    for (let attempt = 0; attempt < maxAttempts && extraPlaced < maxExtra; attempt++) {
        if (candidatePools.length === 0) break;

        const pool = weightedRandomPool(candidatePools);
        const picked = pickStructureForPlanning(activePools, pool);
        if (!picked) continue;

        // Rotation depends on chosen XZ, so first use max possible footprint for sampling safety.
        const roughHalf = Math.ceil(Math.max(picked.width, picked.depth) / 2);

        const rangeX = Math.max(0, bounds.maxX - bounds.minX - 2 * roughHalf);
        const rangeZ = Math.max(0, bounds.maxZ - bounds.minZ - 2 * roughHalf);
        if (rangeX <= 0 || rangeZ <= 0) continue;

        const x = int(bounds.minX + roughHalf + Math.random() * rangeX);
        const z = int(bounds.minZ + roughHalf + Math.random() * rangeZ);

        const metrics = getStructureSpotMetrics(plan, pool, x, z, picked);
        if (!metrics) continue;

        if (!isInsideSafeArea(plan, x, z, metrics.half)) continue;

        let ok = true;
        for (const p of placed) {
            if (boxesOverlap(metrics.box, p.box, STRUCTURE_GAP)) {
                ok = false;
                break;
            }
        }

        if (!ok) continue;

        spots.push({
            x,
            z,
            pool,
            required: false,
            picked: metrics.picked,
            rotation: metrics.rotation,
            fw: metrics.fw,
            fd: metrics.fd,
            foundationRadius: metrics.half,
            footprintBox: metrics.box,
            index: spots.length,
        });

        placed.push({ box: metrics.box });
        extraPlaced++;
    }

    return spots;
}

// -------------------------------------------------------
// Plan validation
// -------------------------------------------------------

/**
 * Returns how many wall rings this camp size should have.
 */
function getWallLayerCount(sizeKey) {
    return WALL_LAYER_COUNT[sizeKey] ?? 1;
}

/**
 * Generates all wall-ring point arrays for a plan.
 * Ring 0 is the outermost wall (at sizeDef.diameter).
 * Each subsequent ring is WALL_LAYER_SPACING blocks closer to the center.
 * Points that already appear in an outer ring are stripped from inner rings
 * so pillars never stack on the same XZ position.
 */
function generateAllWallLayers(shapeKey, cx, cz, sizeDef) {
    const layerCount = getWallLayerCount(sizeDef.key);
    const layers = [];
    const usedPositions = new Set();

    for (let i = 0; i < layerCount; i++) {
        // Ring 0 = outermost (original diameter), ring 1 = one step inward, etc.
        const ringDiameter = sizeDef.diameter - i * WALL_LAYER_SPACING * 2;
        if (ringDiameter < 5) break; // sanity guard

        const rawPoints = shapeKey === "rectangle"
            ? generateRectangleWall(cx, cz, sizeDef.diameter, i)
            : generateWallPoints(shapeKey, cx, cz, ringDiameter);

        // Filter out any XZ position already occupied by an outer ring
        const filteredPoints = rawPoints.filter(p => {
            const k = key2(p.x, p.z);
            return !usedPositions.has(k);
        });

        // Register all positions of this ring so inner rings avoid them
        for (const p of filteredPoints) {
            usedPositions.add(key2(p.x, p.z));
        }

        layers.push(filteredPoints);
    }

    return layers;
}

function createPlan(cx, cy, cz, sizeDef, shapeDef, activePools) {
    // Shared layout index is no longer needed (we generate spots procedurally)
    const wallLayers = generateAllWallLayers(shapeDef.key, cx, cz, sizeDef);
    const wallPoints = wallLayers[0] ?? [];

    const plan = {
        center: { x: cx, y: cy, z: cz },
        size: sizeDef,
        shape: shapeDef,
        wallPoints,
        wallLayers,          // multi-ring walls
        structureSpots: [],
        validStructureSpots: [],
        invalidStructureSpots: [],
        weight: 0,
    };

    // Generate the randomized structure list now that we have the plan object
    // (needed for interior bounds + collision checks)
    plan.structureSpots = generateStructureSpots(plan, activePools);

    return plan;
}

// Minimum valid spot ratio required before a size is even considered
const MIN_VALID_RATIO = {
    very_small: 1.0,
    small: 0.75,
    medium: 0.75,
    big: 0.65,
    very_big: 0.55,
    huge: 0.55,
};

async function validatePlan(plan, dimension, cache) {
    let requiredFailed = false;

    for (const spot of plan.structureSpots) {
        const top = getGroundY(dimension, spot.x, spot.z, plan.center.y, cache);

        if (!top.ok) {
            plan.invalidStructureSpots.push({ ...spot, suitable: false, reason: top.reason });
            if (spot.required) requiredFailed = true;
            continue;
        }

        // NEW: liquid surface → invalid, but recoverable after platform placement
        if (isLiquidType(top.typeId)) {
            plan.invalidStructureSpots.push({
                ...spot,
                suitable: false,
                y: top.y,
                blockTypeId: top.typeId,
                reason: "liquid",
            });
            if (spot.required) requiredFailed = true;
            continue;
        }

        const delta = Math.abs(top.y - plan.center.y);

        if (delta > MAX_STRUCTURE_Y_DELTA) {
            plan.invalidStructureSpots.push({
                ...spot,
                suitable: false,
                y: top.y,
                blockTypeId: top.typeId,
                reason: `y_delta_${delta}`,
            });
            if (spot.required) requiredFailed = true;
            continue;
        }

        const baseY = top.y + 1;
        const cornerSupport = structureCornersHaveSupport(
            dimension,
            spot.x,
            baseY,
            spot.z,
            spot.fw,
            spot.fd
        );

        if (!cornerSupport.ok) {
            plan.invalidStructureSpots.push({
                ...spot,
                suitable: false,
                y: top.y,
                blockTypeId: top.typeId,
                reason: cornerSupport.reason,
                badCornerX: cornerSupport.x,
                badCornerZ: cornerSupport.z,
            });
            if (spot.required) requiredFailed = true;
            continue;
        }

        plan.validStructureSpots.push({
            ...spot,
            suitable: true,
            y: top.y,
            blockTypeId: top.typeId,
        });
    }

    if (requiredFailed) return false;
    if (plan.validStructureSpots.length === 0) return false;

    const usableRatio = plan.validStructureSpots.length / Math.max(1, plan.structureSpots.length);
    const minRatio = MIN_VALID_RATIO[plan.size.key] ?? 0.9;

    // Reject if terrain is too poor for this camp size
    if (usableRatio < minRatio) return false;

    // Weight: size preference * shape preference * terrain quality
    // Poor terrain still reduces weight, but only valid plans get here
    plan.weight = plan.size.weight * plan.shape.weight * (0.5 + usableRatio * 1.35);

    return true;
}

function weightedRandom(plans) {
    const total = plans.reduce((sum, p) => sum + Math.max(0, p.weight), 0);

    if (total <= 0) {
        return plans[Math.floor(Math.random() * plans.length)];
    }

    let roll = Math.random() * total;

    for (const plan of plans) {
        roll -= plan.weight;
        if (roll <= 0) return plan;
    }

    return plans[plans.length - 1];
}

async function chooseCampPlan(dimension, cx, cy, cz, candidateSizes, cache, activePools) {

    for (const sizeDef of candidateSizes) {
        const validPlans = [];

        for (const shapeDef of CAMP_SHAPES) {
            const plan = createPlan(cx, cy, cz, sizeDef, shapeDef, activePools);
            const ok = await validatePlan(plan, dimension, cache);
            if (ok) validPlans.push(plan);
        }

        if (validPlans.length > 0) {
            const plan = weightedRandom(validPlans);
            console.warn(
                `[camp] PLAN picked size=${plan.size.key} shape=${plan.shape.key} ` +
                `validShapes=${validPlans.length} weight=${plan.weight.toFixed(2)}`
            );
            return { ok: true, plan };
        }
    }

    return { ok: false, reason: "no_valid_camp_plan" };
}

function getGroundY(dimension, x, z, centerY, cache = null) {
    let k;
    if (cache) {
        k = key2(x, z);
        const hit = cache.get(k);
        if (hit !== undefined) return hit;
    }
    const maxY = clampY(centerY + TERRAIN_SCAN_UP);
    const minY = clampY(centerY - TERRAIN_SCAN_DOWN);
    for (let y = maxY; y >= minY; y--) {
        const block = getBlockSafe(dimension, x, y, z);
        if (!shouldIgnoreForTerrainTop(block)) {
            const res = { ok: true, y, typeId: block?.typeId ?? "minecraft:air" };
            if (cache) cache.set(k, res);
            return res;
        }
    }
    const res = { ok: false };
    if (cache) cache.set(k, res);
    return res;
}

// Removes dropped items inside the same volume used by deforestation). Does not touch mobs.
async function clearDropsInArea(dimension, minX, minY, minZ, maxX, maxY, maxZ) {
    const t0 = now();

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    // sphere that fully covers the box
    const radius = Math.ceil(
        Math.sqrt(
            Math.pow((maxX - minX) / 2, 2) +
            Math.pow((maxY - minY) / 2, 2) +
            Math.pow((maxZ - minZ) / 2, 2)
        )
    ) + 2;

    const dropTypes = ["minecraft:item", "minecraft:xp_orb"];
    let removed = 0;

    for (const type of dropTypes) {
        let entities;
        try {
            entities = dimension.getEntities({
                type,
                location: { x: cx, y: cy, z: cz },
                maxDistance: radius,
            });
        } catch {
            continue;
        }

        for (const e of entities) {
            // tight AABB filter so we don't delete drops outside the real box
            const loc = e.location;
            if (
                loc.x < minX || loc.x > maxX ||
                loc.y < minY || loc.y > maxY ||
                loc.z < minZ || loc.z > maxZ
            ) continue;

            try {
                e.remove();
                removed++;
            } catch { /* already gone */ }
        }
        await budgetYield(); // stay under command budget if many drops
    }
}

// -------------------------------------------------------
// Supports / platforms
// -------------------------------------------------------

// Fills only the 4 vertical side-faces of a box (not the solid interior),
// without ever re-filling the same corner cell twice:
//   - North/South rows span the FULL X width (they "own" the 4 corners).
//   - West/East columns only span the INTERIOR Z range (minZ+1..maxZ-1),
//     so they never re-touch the corners already placed by North/South.
async function fillAreaSidesOnly(dimension, minX, minY, minZ, maxX, maxY, maxZ, blockType, replaceTarget = null) {
    const suffix = replaceTarget ? ` replace ${replaceTarget}` : "";
    const y1 = clampY(minY), y2 = clampY(maxY);

    // North face (full width, includes both NW/NE corners)
    dimension.runCommand(`fill ${minX} ${y1} ${minZ} ${maxX} ${y2} ${minZ} ${blockType}${suffix}`);
    await budgetYield();

    // South face (full width, includes both SW/SE corners) — skip if it's the same row as North
    if (maxZ !== minZ) {
        dimension.runCommand(`fill ${minX} ${y1} ${maxZ} ${maxX} ${y2} ${maxZ} ${blockType}${suffix}`);
        await budgetYield();
    }

    // West/East faces — only the interior Z range, corners already done above
    if (maxZ - minZ >= 2) {
        dimension.runCommand(`fill ${minX} ${y1} ${minZ + 1} ${minX} ${y2} ${maxZ - 1} ${blockType}${suffix}`);
        await budgetYield();

        if (maxX !== minX) {
            dimension.runCommand(`fill ${maxX} ${y1} ${minZ + 1} ${maxX} ${y2} ${maxZ - 1} ${blockType}${suffix}`);
            await budgetYield();
        }
    }
}

/**
 * Places a support platform centered at (cx, topY, cz).
 * Top layer: full sizeX × sizeZ rectangle (exact structure footprint, replace-only).
 * Corner pillars: 3 outer blocks per corner drilled straight down to solid ground
 * (the inner corner block is intentionally skipped — it's covered by the
 * DEFAULT_SUPPORT_BLOCK fill below instead).
 * Support fill: DEFAULT_SUPPORT_BLOCK filling the area 1 block smaller (on every
 * side) than the platform, going down to the interior platform's Y level or
 * 2 blocks under the lowest corner pillar — whichever is higher up.
 */
async function placeSupportPlatform(dimension, cx, topY, cz, sizeX, sizeZ, blockType, platformY) {
    
    const minX = cx - Math.floor(sizeX / 2);
    const maxX = minX + sizeX - 1;
    const minZ = cz - Math.floor(sizeZ / 2);
    const maxZ = minZ + sizeZ - 1;

    // Top layer — exact structure footprint, only fills air gaps and marker blocks
    for (const replaceBlock of ["minecraft:air", "minecraft:emerald_block"]) {
        dimension.runCommand(
            `fill ${minX} ${clampY(topY)} ${minZ} ${maxX} ${clampY(topY)} ${maxZ} ${blockType} replace ${replaceBlock}`
        );
        await budgetYield();
    }

    // Corner pillars drill downward through air/liquid to the first solid block
    // (3 outer blocks per corner only — see comment on placeFoundationPillars)
    const lowestPillarY = await placeFoundationPillars(dimension, minX, maxX, minZ, maxZ, topY);

    // Support fill: inset by 1 block on every side, stopping at whichever
    // boundary is higher up — the interior platform level, or 2 blocks under
    // the lowest corner pillar.
    const insetMinX = minX + 1, insetMaxX = maxX - 1;
    const insetMinZ = minZ + 1, insetMaxZ = maxZ - 1;
    const fillTop = topY - 1;
    const fillBottom = Math.max(platformY, lowestPillarY - 2);

    // Only needed when the ground isn't flat — if every corner pillar stopped
    // right at topY, the terrain is level and there's nothing to fill in.
    const groundIsUneven = lowestPillarY < topY;

    if (groundIsUneven && insetMaxX >= insetMinX && insetMaxZ >= insetMinZ && fillTop >= fillBottom) {
        await fillAreaSidesOnly(
            dimension,
            insetMinX, fillBottom, insetMinZ,
            insetMaxX, fillTop, insetMaxZ,
            DEFAULT_SUPPORT_BLOCK
        );
    }
}

// Drills 3 of the 4 blocks at each corner of the footprint straight down to
// solid ground (skips the innermost diagonal block — that position is
// already covered by the DEFAULT_SUPPORT_BLOCK inset fill in
// placeSupportPlatform, so a separate pillar there would be redundant).
// Returns the lowest Y any of the pillars had to reach.
async function placeFoundationPillars(dimension, minX, maxX, minZ, maxZ, topY) {
    const corners = [
        { x: minX, z: minZ, dx: 1, dz: 1 },
        { x: maxX, z: minZ, dx: -1, dz: 1 },
        { x: minX, z: maxZ, dx: 1, dz: -1 },
        { x: maxX, z: maxZ, dx: -1, dz: -1 },
    ];

    let lowestY = topY;

    for (const corner of corners) {
        const y1 = await placePillarDown(dimension, corner.x, topY, corner.z, FOUNDATION_PILLAR_BLOCK);
        const y2 = await placePillarDown(dimension, corner.x + corner.dx, topY, corner.z, FOUNDATION_PILLAR_BLOCK);
        const y3 = await placePillarDown(dimension, corner.x, topY, corner.z + corner.dz, FOUNDATION_PILLAR_BLOCK);
        // corner.x + corner.dx, corner.z + corner.dz (the inner diagonal block) is
        // intentionally skipped here.
        lowestY = Math.min(lowestY, y1, y2, y3);
    }

    return lowestY;
}

// -------------------------------------------------------
// Deforestation
// -------------------------------------------------------

const DEFOREST_LOGS = [
    "minecraft:oak_log", "minecraft:spruce_log", "minecraft:birch_log",
    "minecraft:jungle_log", "minecraft:acacia_log", "minecraft:dark_oak_log",
    "minecraft:mangrove_log", "minecraft:cherry_log", "minecraft:pale_oak_log"
];

const DEFOREST_LEAVES = [
    "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves",
    "minecraft:jungle_leaves", "minecraft:acacia_leaves", "minecraft:dark_oak_leaves",
    "minecraft:mangrove_leaves", "minecraft:cherry_leaves", "minecraft:pale_oak_leaves",
    "minecraft:azalea_leaves", "minecraft:azalea_leaves_flowered"
];

const DEFOREST_MISC = [
    "minecraft:red_mushroom_block", "minecraft:brown_mushroom_block", "minecraft:mushroom_stem", "minecraft:tall_grass", "minecraft:large_fern", "minecraft:fern",
    "minecraft:reeds", "minecraft:bamboo", "minecraft:vine", "minecraft:mangrove_roots"
];

const DEFOREST_CHUNK_XZ = 48; // chunk size per fillBlocks call
const DEFOREST_CHUNK_Y = 14; // 48*48*14 = 32256, safely under /fill limit

async function deforestArea(dimension, minX, minY, minZ, maxX, maxY, maxZ) {
    const allBlocks = [...DEFOREST_LEAVES, ...DEFOREST_LOGS, ...DEFOREST_MISC];

    const y1 = clampY(Math.min(minY, maxY));
    const y2 = clampY(Math.max(minY, maxY));

    const xs = [];
    const ys = [];
    const zs = [];

    for (let x = minX; x <= maxX; x += DEFOREST_CHUNK_XZ) xs.push(x);
    for (let y = y1; y <= y2; y += DEFOREST_CHUNK_Y) ys.push(y);
    for (let z = minZ; z <= maxZ; z += DEFOREST_CHUNK_XZ) zs.push(z);

    for (const cx of xs) {
        for (const cy of ys) {
            for (const cz of zs) {

                const x2 = Math.min(cx + DEFOREST_CHUNK_XZ - 1, maxX);
                const y2s = Math.min(cy + DEFOREST_CHUNK_Y - 1, y2);
                const z2 = Math.min(cz + DEFOREST_CHUNK_XZ - 1, maxZ);

                for (const blockId of allBlocks) {
                    try {
                        dimension.runCommand(
                            `fill ${cx} ${cy} ${cz} ${x2} ${y2s} ${z2} minecraft:air replace ${blockId}`
                        );
                    } catch (e) {
                        console.warn(
                            `[deforest] fill failed box=(${cx},${cy},${cz})->(${x2},${y2s},${z2}) block=${blockId} err=${e}`
                        );
                    }
                    await budgetYield();
                }
            }
        }
    }
}

async function deforestAreaCircle(dimension, cx, cz, radius, minY, maxY) {
    const allBlocks = [...DEFOREST_LEAVES, ...DEFOREST_LOGS, ...DEFOREST_MISC];

    const y1 = clampY(Math.min(minY, maxY));
    const y2 = clampY(Math.max(minY, maxY));

    const ys = [];
    for (let y = y1; y <= y2; y += DEFOREST_CHUNK_Y) ys.push(y);

    for (let dz = -radius; dz <= radius; dz++) {
        const chordR = Math.floor(Math.sqrt(Math.max(0, radius * radius - dz * dz)));
        const z = cz + dz;
        const xMin = cx - chordR;
        const xMax = cx + chordR;

        for (const cy of ys) {
            const y2s = Math.min(cy + DEFOREST_CHUNK_Y - 1, y2);

            for (const blockId of allBlocks) {
                try {
                    dimension.runCommand(
                        `fill ${xMin} ${cy} ${z} ${xMax} ${y2s} ${z} minecraft:air replace ${blockId}`
                    );
                } catch (e) {
                    console.warn(
                        `[deforest] circle row failed z=${z} y=${cy}-${y2s} block=${blockId} err=${e}`
                    );
                }
                await budgetYield();
            }
        }
    }
}

async function deforestAreaForPlan(dimension, plan, centerX, centerY, centerZ) {
    const pad = TOWER_MAX_FOOTPRINT + DEFOREST_PAD;
    const minY = centerY - MAX_STRUCTURE_Y_DELTA - 10;
    const maxY = centerY + 70;

    if (plan.shape.key === "circle") {
        const radius = Math.floor(plan.size.diameter / 2) + pad;
        await deforestAreaCircle(dimension, centerX, centerZ, radius, minY, maxY);
        return;
    }

    // square / rectangle — use the plan's real half-extents (rectangle is
    // shallower in Z than it is wide in X, so this no longer over-clears it
    // into a square).
    const { halfW, halfD } = getPlanHalfExtents(plan, pad);

    await deforestArea(
        dimension,
        centerX - halfW, minY, centerZ - halfD,
        centerX + halfW, maxY, centerZ + halfD
    );
}

// -------------------------------------------------------
// Interior platform
// -------------------------------------------------------

async function placeInteriorPlatform(dimension, plan, platformY) {
    const cx = plan.center.x;
    const cz = plan.center.z;
    platformY = clampY(platformY);

    const { r, halfW, halfD } = getPlanHalfExtents(plan, 1);
    const isCircle = plan.shape.key === "circle";

    if (!isCircle) {

        const FILL_CHUNK = 100; // safe chunk size (100*100 = 10,000 blocks per fill)

        for (let fx = cx - halfW; fx <= cx + halfW; fx += FILL_CHUNK) {
            for (let fz = cz - halfD; fz <= cz + halfD; fz += FILL_CHUNK) {
                const x1 = fx;
                const x2 = Math.min(fx + FILL_CHUNK - 1, cx + halfW);
                const z1 = fz;
                const z2 = Math.min(fz + FILL_CHUNK - 1, cz + halfD);
                dimension.runCommand(
                    `fill ${x1} ${platformY} ${z1} ${x2} ${platformY} ${z2} ${INTERIOR_PLATFORM_BLOCK}`
                );
            }
        }
        return;
    }

    // Circle: fill row by row using chord width at each Z offset
    const rPad = r + 2;
    for (let dz = -rPad; dz <= rPad; dz++) {
        const chordR = Math.floor(Math.sqrt(rPad * rPad - dz * dz));
        if (chordR < 0) continue;
        const z = cz + dz;
        dimension.runCommand(
            `fill ${cx - chordR} ${platformY} ${z} ${cx + chordR} ${platformY} ${z} ${INTERIOR_PLATFORM_BLOCK}`
        );
    }
}

async function placeInteriorPlatformPillars(dimension, plan, platformY) {
    const cx = plan.center.x;
    const cz = plan.center.z;
    platformY = clampY(platformY);

    const { r, halfW, halfD } = getPlanHalfExtents(plan, -1);

    const seen = new Set();
    const tryPillar = async (x, z) => {
        const k = key2(x, z);
        if (seen.has(k)) return;
        seen.add(k);
        await placePillarDown(dimension, x, platformY, z, FOUNDATION_PILLAR_BLOCK);
    };

    if (plan.shape.key === "circle") {
        // Pillars spaced ~every 10 blocks around the platform edge.
        const rPad = r;
        const circumference = 2 * Math.PI * rPad;
        const count = Math.max(4, Math.round(circumference / INTERIOR_PILLAR_SPACING));
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const x = Math.round(cx + Math.cos(a) * rPad);
            const z = Math.round(cz + Math.sin(a) * rPad);
            await tryPillar(x, z);
        }
        return;
    }

    // Square / rectangle: match the exact platform extents used in placeInteriorPlatform
    const minX = cx - halfW, maxX = cx + halfW;
    const minZ = cz - halfD, maxZ = cz + halfD;

    // North & south edges (every 10 blocks + guaranteed end corners)
    for (let x = minX; x <= maxX; x += INTERIOR_PILLAR_SPACING) {
        await tryPillar(x, minZ);
        await tryPillar(x, maxZ);
    }
    await tryPillar(maxX, minZ);
    await tryPillar(maxX, maxZ);

    // West & east edges (every 10 blocks + guaranteed end corners)
    for (let z = minZ; z <= maxZ; z += INTERIOR_PILLAR_SPACING) {
        await tryPillar(minX, z);
        await tryPillar(maxX, z);
    }
    await tryPillar(minX, maxZ);
}

// -------------------------------------------------------
// Walls
// -------------------------------------------------------

async function placeWallPillar(dimension, x, groundY, z, height, platformY) {
    const baseY = clampY(groundY);
    const topY = clampY(groundY + height - 1);

    // Fill gap downward to platform (air and water only)
    if (platformY < baseY) {
        for (const replaceBlock of ["minecraft:air", "minecraft:water", "minecraft:lava"]) {
            dimension.runCommand(
                `fill ${x} ${clampY(platformY)} ${z} ${x} ${clampY(baseY - 1)} ${z} ${WALL_BLOCK} replace ${replaceBlock}`
            );
        }
        await budgetYield();
    }

    // Fill the main pillar body (excluding cap)
    if (baseY < topY) {
        dimension.runCommand(`fill ${x} ${baseY} ${z} ${x} ${clampY(topY - 1)} ${z} ${WALL_BLOCK}`);
        await budgetYield();
    }

    // Place cap
    await setBlock(dimension, x, topY, z, WALL_CAP_BLOCK);
}

async function fillGapUnderRaisedPillar(dimension, x, z, previousGroundY, currentGroundY) {
    if (previousGroundY === null || previousGroundY === undefined) return;
    if (currentGroundY <= previousGroundY + 2) return;

    const checkY = clampY(previousGroundY + 2);
    const typeId = getBlockTypeSafe(dimension, x, checkY, z);

    if (!isAirType(typeId)) return;

    for (let y = checkY; y < currentGroundY; y++) {
        await setBlock(dimension, x, y, z, WALL_BLOCK);
    }
}

async function placeWalls(dimension, plan, foundationBlock, platformY, wallPoints = null) {
    const center = plan.center;

    const wall_height = plan.size.wallHeight;

    let previousGroundY = null;

    // console.warn(`[camp] WALL start pillars=${plan.wallPoints.length}`);

    // let totalLoadWaitMs = 0;
    // let totalPillarMs = 0;
    // let slowPillars = 0;

    const points = wallPoints ?? plan.wallPoints;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        // const pillarStart = now();

        const top = getGroundY(dimension, p.x, p.z, plan.center.y);

        if (!top.ok) {
            previousGroundY = null;
            continue;
        }

        let wallGroundY = top.y;

        if (top.y < platformY) {
            // console.warn(`[camp] WALL pillar #${i} needs bridge at (${p.x},${p.z}) groundY=${top.y} platformY=${platformY} !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);

            const bridgeStart = now();

            await placeSupportPlatform(
                dimension,
                p.x, platformY, p.z,
                plan.size.supportRadius * 2 + 1,
                plan.size.supportRadius * 2 + 1,
                foundationBlock,
                platformY
            );
            // console.warn(`[camp] WALL bridge done at (${p.x},${p.z}) took=${now() - bridgeStart}ms`);

            wallGroundY = platformY;
        }

        // Crevice/spike detection — compare top Y positions
        let adjustedHeight = wall_height;

        if (previousGroundY !== null) {
            // const currentTopY = wallGroundY + adjustedHeight - 1;
            const threshold = Math.floor(adjustedHeight * 0.5);
            const delta = wallGroundY - previousGroundY;

            if (delta <= -threshold) {
                // Sudden drop: we "fell into" a crevice.
                // Make this pillar's top match previousTopY - 1.
                adjustedHeight = Math.max(1, (previousGroundY + wall_height - 2) - wallGroundY + 1);
            } else if (delta >= threshold) {
                // Sudden spike: we "got out" of a crevice.
                // The previous pillar needs to be extended to currentTopY - 1.
                // We re-place just the cap portion of the previous pillar.
                const prevPoint = points[i - 1];
                if (prevPoint && previousGroundY !== null) {
                    if (wallGroundY > previousGroundY) {
                        const extendedTopY = wallGroundY + adjustedHeight - 2;
                        dimension.runCommand(
                            `fill ${int(prevPoint.x)} ${clampY(previousGroundY)} ${int(prevPoint.z)} ${int(prevPoint.x)} ${clampY(extendedTopY - 1)} ${int(prevPoint.z)} ${WALL_BLOCK}`
                        );
                        await setBlock(dimension, prevPoint.x, extendedTopY, prevPoint.z, WALL_CAP_BLOCK);
                        await budgetYield();
                    }
                }
            }
        }

        const loadStart = now();
        await fillGapUnderRaisedPillar(dimension, p.x, p.z, previousGroundY, wallGroundY);
        await placeWallPillar(dimension, p.x, wallGroundY, p.z, adjustedHeight, platformY);
        const loadMs = now() - loadStart;
        // totalLoadWaitMs += loadMs;

        previousGroundY = wallGroundY;
        // previousTopY = wallGroundY + adjustedHeight - 1;


        // const pillarMs = now() - pillarStart;
        // totalPillarMs += pillarMs;

        // if (pillarMs > 500) {
        // slowPillars++;
        // console.warn(`[camp] WALL slow pillar #${i} at (${p.x},${p.z}) pillar=${pillarMs}ms load=${loadMs}ms`);
        // }

        if (i % 40 === 0) {
            // console.warn(
            //     `[camp] WALL progress ${i}/${plan.points.length} ` +
            //     `avgPillar=${Math.round(totalPillarMs / Math.max(1, i + 1))}ms ` +
            //     `totalLoad=${totalLoadWaitMs}ms slowPillars=${slowPillars}`
            // );
            await nextTick();
        }
    }

    // console.warn(
    //     `[camp] WALL done pillars=${plan.wallPoints.length} ` +
    //     `totalLoad=${totalLoadWaitMs}ms totalPillar=${totalPillarMs}ms slowPillars=${slowPillars}`
    // );

    // console.warn("[camp] WALL done");
}

// -------------------------------------------------------
// Structures / towers
// -------------------------------------------------------

async function placeStructureFromPool(dimension, poolKey, x, groundY, z, preferredRotation = null, activePools = null, prePicked = null) {
    const pool = activePools?.[poolKey] ?? [];
    const picked = prePicked ?? randomFromArray(pool);

    if (!picked) {
        return { placed: false, reason: `empty_pool_${poolKey}` };
    }

    const { width = 1, depth = 1 } = picked;
    const yOffset = 1;
    const rotation = preferredRotation ?? "0_degrees";

    // Center using the rotated footprint so placement lines up with the foundation
    const { fw, fd } = getRotatedFootprint(width, depth, rotation);

    const placeX = int(x - Math.floor(fw / 2));
    const placeY = int(groundY + yOffset);
    const placeZ = int(z - Math.floor(fd / 2));

    dimension.runCommand(
        `structure load ${picked.id} ${placeX} ${placeY} ${placeZ} ${rotation} none`
    );
    await budgetYield();

    return { placed: true, id: picked.id, rotation };
}

/**
 * Outward unit normal for a wall point.
 * - Circle: true radial direction from center (correct there).
 * - Square/Rectangle: axis-aligned normal perpendicular to the nearest wall
 *   face, so corner towers keep the same gap from the wall as mid-wall towers
 *   instead of being pulled in diagonally.
 */
function getWallOutwardNormal(px, pz, cx, cz, plan) {
    const dx = px - cx;
    const dz = pz - cz;

    if (plan.shape.key === "circle") {
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len === 0) return { nx: 0, nz: 0 };
        return { nx: dx / len, nz: dz / len };
    }

    const { halfW, halfD } = getPlanHalfExtents(plan);

    const relX = halfW === 0 ? 0 : Math.abs(dx) / halfW;
    const relZ = halfD === 0 ? 0 : Math.abs(dz) / halfD;

    // Whichever face the point is closest to determines the push direction.
    if (relX >= relZ) {
        return { nx: Math.sign(dx) || 1, nz: 0 };
    }
    return { nx: 0, nz: Math.sign(dz) || 1 };
}

/**
 * Places 1–4 gates on the cardinal sides of the outermost wall.
 * For every selected side the same gate is also placed on every inner wall layer
 * so the opening goes cleanly through the whole multi-layer wall.
 * Gate Y is taken from the innermost layer so all layers line up.
 * Structure is 4×4×1; rotated 90° only on the east/west sides.
 */
async function placeGates(dimension, plan, platformY) {
    const desired = GATE_COUNT[plan.size.key] ?? 1;
    if (desired <= 0) return;

    const sides = [
        { dir: "n", dx: 0, dz: -1 },
        { dir: "s", dx: 0, dz: 1 },
        { dir: "e", dx: 1, dz: 0 },
        { dir: "w", dx: -1, dz: 0 },
    ];

    // try sides in random order; skip any that fail the wall-continuity check
    const candidates = [...sides].sort(() => Math.random() - 0.5);
    let placed = 0;

    const layerCount = plan.wallLayers.length;

    for (const side of candidates) {
        if (placed >= desired) break;

        // ----- outermost layer position (used for the continuity check) -----
        const outerDiam = plan.size.diameter;
        let outerHX, outerHZ;
        if (plan.shape.key === "rectangle") {
            outerHX = Math.floor(plan.size.diameter / 2);
            outerHZ = Math.floor(rectangleDepth(plan.size.diameter) / 2);
        } else {
            const h = Math.floor(outerDiam / 2);
            outerHX = h;
            outerHZ = h;
        }
        const ox = int(plan.center.x + side.dx * outerHX);
        const oz = int(plan.center.z + side.dz * outerHZ);

        // ----- shared gate base Y (taken from innermost layer, same as before) -----
        const innerIdx = layerCount - 1;
        const innerDiam = plan.size.diameter - innerIdx * WALL_LAYER_SPACING * 2;
        let innerHX, innerHZ;
        if (plan.shape.key === "rectangle") {
            const shrink = innerIdx * WALL_LAYER_SPACING;
            innerHX = Math.floor(plan.size.diameter / 2) - shrink;
            innerHZ = Math.floor(rectangleDepth(plan.size.diameter) / 2) - shrink;
        } else {
            const h = Math.floor(innerDiam / 2);
            innerHX = h;
            innerHZ = h;
        }
        const innerX = int(plan.center.x + side.dx * innerHX);
        const innerZ = int(plan.center.z + side.dz * innerHZ);

        const top = getGroundY(dimension, innerX, innerZ, plan.center.y);
        let gateBaseY = top.ok
            ? top.y - (plan.size.wallHeight - 1)
            : platformY;
        gateBaseY = Math.max(platformY, gateBaseY);
        gateBaseY = clampY(gateBaseY + 1);

        const checkY = clampY(gateBaseY + 1);   // one block above the gate base

        // ----- continuity check: 1 block left + 1 block right of the 4-wide gate -----
        // must both be WALL_BLOCK at checkY
        let leftX, leftZ, rightX, rightZ;
        if (side.dir === "n" || side.dir === "s") {
            // wall runs along X
            const half = Math.floor(GATE_WIDTH / 2);          // 2
            leftX = ox - half - 1;
            rightX = ox + (GATE_WIDTH - half);               // ox + 2
            leftZ = rightZ = oz;
        } else {
            // wall runs along Z
            const half = Math.floor(GATE_WIDTH / 2);
            leftZ = oz - half - 1;
            rightZ = oz + (GATE_WIDTH - half);
            leftX = rightX = ox;
        }

        const leftType = getBlockTypeSafe(dimension, leftX, checkY, leftZ);
        const rightType = getBlockTypeSafe(dimension, rightX, checkY, rightZ);

        if (leftType !== WALL_BLOCK || rightType !== WALL_BLOCK) {
            // not a clean wall segment → try next side
            continue;
        }

        // ----- all good → place the gate on every wall layer -----
        const rotation = (side.dir === "e" || side.dir === "w")
            ? "90_degrees"
            : "0_degrees";

        for (let li = 0; li < layerCount; li++) {
            const diam = plan.size.diameter - li * WALL_LAYER_SPACING * 2;
            if (diam < 5) continue;

            let hx, hz;
            if (plan.shape.key === "rectangle") {
                const shrink = li * WALL_LAYER_SPACING;
                hx = Math.floor(plan.size.diameter / 2) - shrink;
                hz = Math.floor(rectangleDepth(plan.size.diameter) / 2) - shrink;
            } else {
                const h = Math.floor(diam / 2);
                hx = h;
                hz = h;
            }

            const px = int(plan.center.x + side.dx * hx);
            const pz = int(plan.center.z + side.dz * hz);

            const { fw, fd } = getRotatedFootprint(GATE_WIDTH, GATE_DEPTH, rotation);
            const placeX = px - Math.floor(fw / 2);
            const placeZ = pz - Math.floor(fd / 2);

            dimension.runCommand(
                `structure load ${GATE_STRUCTURE_ID} ${placeX} ${gateBaseY} ${placeZ} ${rotation} none`
            );
            await budgetYield();
        }

        placed++;
    }
}

async function placeTowers(dimension, plan, foundationBlock, platformY, activePools, poolQueues) {
    const allTowers = activePools?.small_tower ?? [];
    if (allTowers.length === 0) return { placed: 0, skipped: 0 };

    const cx = plan.center.x;
    const cz = plan.center.z;
    const spacing = plan.size.towerSpacing;
    const points = plan.wallPoints;

    let placed = 0, skipped = 0;

    // Collect all wall points where a tower would be placed
    const towerCandidateIndices = [];
    {
        let accumCheck = 0;
        let lastPCheck = null;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (lastPCheck !== null) accumCheck += dist2D(p.x, p.z, lastPCheck.x, lastPCheck.z);
            lastPCheck = p;
            if (i !== 0 && accumCheck < spacing) continue;
            accumCheck = 0;
            towerCandidateIndices.push(i);
        }
    }

    // How many unique small tower variants to rotate around the wall
    const variantCount = (plan.size.key === "huge" || plan.size.key === "very_big") ? 3 : 2;

    // Pick that many unique small towers from the queue
    const selectedVariants = [];
    for (let i = 0; i < variantCount; i++) {
        const picked = drawFromQueue(poolQueues, "small_tower");
        if (!picked) break;
        selectedVariants.push(picked);
    }

    if (selectedVariants.length === 0) {
        return { placed: 0, skipped: 0 };
    }

    // Determine the first tower's wall-point position for wrap-around check
    const firstCandidatePoint = towerCandidateIndices.length > 0
        ? points[towerCandidateIndices[0]]
        : null;

    for (let ci = 0; ci < towerCandidateIndices.length; ci++) {
        const i = towerCandidateIndices[ci];
        const p = points[i];

        // Skip the last candidate if it's too close to the first (wrap-around)
        if (ci === towerCandidateIndices.length - 1 && ci > 0 && firstCandidatePoint) {
            const distToFirst = dist2D(p.x, p.z, firstCandidatePoint.x, firstCandidatePoint.z);
            if (distToFirst < spacing) {
                skipped++;
                continue;
            }
        }

        // Cycle through the selected variants in an alternating pattern
        const towerPicked = selectedVariants[ci % selectedVariants.length];

        const rotation = rotationTowardCampCenter(p.x, p.z, cx, cz, towerPicked.face);
        const { fw, fd } = getRotatedFootprint(towerPicked.width, towerPicked.depth, rotation);
        const halfOutset = Math.ceil(Math.max(fw, fd) / 2) + WALL_TOWER_OUTSET;

        const { nx, nz } = getWallOutwardNormal(p.x, p.z, cx, cz, plan);
        const ox = Math.round(nx * halfOutset);
        const oz = Math.round(nz * halfOutset);
        const tx = p.x + ox;
        const tz = p.z + oz;

        // Tower Y: use ground height, but clamp based on water presence.
        let top = getGroundY(dimension, tx, tz, plan.center.y);
        if (!top.ok) { skipped++; continue; }

        const towerGroundIsWater = isLiquidType(top.typeId);
        let y;
        if (towerGroundIsWater) {
            y = Math.max(platformY, top.y);
        } else {
            const minTowerY = platformY - TOWER_NEGATIVE_Y_ALLOWANCE;
            y = top.y >= minTowerY ? top.y : platformY;
        }

        await placeStructureFromPool(dimension, "small_tower", tx, y, tz, rotation, activePools, towerPicked);

        await placeSupportPlatform(dimension, tx, y + 1, tz, fw, fd, foundationBlock, platformY);

        // Fill the small gap between the tower's inner edge and the wall point
        const innerEdgeX = tx - Math.round(nx * Math.floor(fw / 2));
        const innerEdgeZ = tz - Math.round(nz * Math.floor(fd / 2));

        if (y === platformY) {
            const gapTypeId = getBlockTypeSafe(dimension, innerEdgeX, y, innerEdgeZ);
            if (isAirType(gapTypeId) || isLiquidType(gapTypeId)) {
                const gapMinX = Math.min(innerEdgeX, p.x) - 1;
                const gapMaxX = Math.max(innerEdgeX, p.x) + 1;
                const gapMinZ = Math.min(innerEdgeZ, p.z) - 1;
                const gapMaxZ = Math.max(innerEdgeZ, p.z) + 1;
                dimension.runCommand(
                    `fill ${gapMinX} ${clampY(y)} ${gapMinZ} ${gapMaxX} ${clampY(y)} ${gapMaxZ} ${INTERIOR_PLATFORM_BLOCK}`
                );
                await budgetYield();
            }
        }

        placed++;
        await nextTick();
    }

    return { placed, skipped };
}

async function placeStructures(dimension, plan, activePools, poolQueues, platformY) {
    let placed = 0;
    let skipped = 0;

    for (const spot of plan.validStructureSpots) {
        if (!activePools[spot.pool] || activePools[spot.pool].length === 0) {
            skipped++;
            continue;
        }

        const picked = spot.picked ?? drawFromQueue(poolQueues, spot.pool);
        if (!picked) { skipped++; continue; }

        const rotation = spot.rotation ?? rotationTowardCampCenter(
            spot.x,
            spot.z,
            plan.center.x,
            plan.center.z,
            picked.face
        );

        const { fw, fd } = (spot.fw && spot.fd)
            ? { fw: spot.fw, fd: spot.fd }
            : getRotatedFootprint(picked.width, picked.depth, rotation);

        // Sample Y at the midpoint of the front-facing edge so the entrance
        // is accessible. The front faces toward the camp center, so we offset
        // half the depth in the direction TOWARD the center (inward).
        const dx = plan.center.x - spot.x;
        const dz = plan.center.z - spot.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        const frontOffsetX = len === 0 ? 0 : Math.round((dx / len) * Math.floor(fd / 2));
        const frontOffsetZ = len === 0 ? 0 : Math.round((dz / len) * Math.floor(fd / 2));
        const sampleX = spot.x + frontOffsetX;
        const sampleZ = spot.z + frontOffsetZ;

        // Don't scan from world height. Walk from the camp's allowed top
        // (center + MAX_STRUCTURE_Y_DELTA) down to the interior platform.
        const scanTop = clampY(plan.center.y + MAX_STRUCTURE_Y_DELTA);
        const scanBottom = platformY;
        let surfaceY = null;

        for (let y = scanTop; y >= scanBottom; y--) {
            const block = getBlockSafe(dimension, sampleX, y, sampleZ);
            
            if (!block) continue;
            if (block.isLiquidBlocking("Water") === false) continue;
            
            surfaceY = y;
            break;
        }

        if (surfaceY === null) {
            skipped++;
            continue;
        }

        const placeY = surfaceY - 1;
        const structureBaseY = placeY + 1;
        const cornerSupport = structureCornersHaveSupport(
            dimension,
            spot.x,
            structureBaseY,
            spot.z,
            fw,
            fd
        );

        if (!cornerSupport.ok) {
            skipped++;
            continue;
        }

        await fillAroundStructure(dimension, spot.x, placeY + 1, spot.z, fw, fd);

        const result = await placeStructureFromPool(
            dimension, spot.pool, spot.x, placeY, spot.z, rotation, activePools, picked
        );

        if (result.placed) placed++;
        else skipped++;

        await placeSupportPlatform(
            dimension,
            spot.x, placeY + 1, spot.z,
            fw, fd,
            INTERIOR_PLATFORM_BLOCK,
            platformY
        );

        await nextTick();
    }

    return { placed, skipped };
}

// Structure Helpers

function pickStyle(biomeId) {
    const lower = biomeId.toLowerCase();

    // Biome-locked first
    for (const entry of BIOME_STYLE_MAP) {
        if (entry.match.some(kw => lower.includes(kw))) {
            return entry.style;
        }
    }

    // Weighted random fallback
    const candidates = Object.entries(STYLE_WEIGHTS).filter(([, w]) => w > 0);
    const total = candidates.reduce((s, [, w]) => s + w, 0);
    let roll = Math.random() * total;
    for (const [key, w] of candidates) {
        roll -= w;
        if (roll <= 0) return key;
    }
    return candidates[candidates.length - 1][0];
}

/**
 * Merges the chosen style pool with the generic pool.
 * Generic structures are always available as fallback.
 */
function buildActivePools(styleKey) {
    const style = STYLE_POOLS[styleKey] ?? {};
    const generic = STYLE_POOLS.generic ?? {};
    const sizes = ["tiny", "small", "medium", "big", "boss", "tower", "small_tower"];
    const merged = {};

    for (const size of sizes) {
        const normalizeEntry = entry => {
            if (typeof entry === "string") {
                const m = entry.match(/_(\d+)x(\d+)x(\d+)$/);
                if (!m) { console.warn(`[camp] Cannot parse dims from id: ${entry}`); return null; }
                return { id: entry, width: +m[1], depth: +m[3], face: "s" };
            }
            return {
                id: entry.id,
                width: entry.w,
                depth: entry.d,
                face: entry.face ?? "s",
            };
        };

        const styleEntries = (style[size] ?? []).map(normalizeEntry).filter(Boolean);
        const genericEntries = (generic[size] ?? []).map(normalizeEntry).filter(Boolean);

        merged[size] = [...styleEntries, ...genericEntries];
    }

    return merged;
}

// -------------------------------------------------------
// Exported builder
// -------------------------------------------------------

export async function buildCamp(dimension, centerX, centerY, centerZ) {
    const start = now();
    let persistentAreas = null;

    // Abort early if a player could see the generation
    if (isPlayerNearby(dimension, centerX, centerY, centerZ, 500)) {
        console.warn(
            `[camp] EARLY SKIP: player within 500 blocks of ${centerX},${centerY},${centerZ}`
        );
        return { placed: false, reason: "player_nearby" };
    }

    const requestedSize = chooseRandomCampSize();
    const loadSpan = getCampLoadSpan(requestedSize);
    const stripCount = getRequiredStripCount(loadSpan);
    if (stripCount === null) { /* ... */ }

    const scanRadius = (loadSpan - 1) / 2;

    // ---- wait for slot ----
    const tSlot = now();
    await waitForBuildSlot(stripCount);
    const slotMs = now() - tSlot;

    try {
        // ---- ticking area ----
        const tArea = now();
        persistentAreas = await addTickingArea(
            dimension,
            centerX - scanRadius, centerY - 60, centerZ - scanRadius,
            centerX + scanRadius, centerY + 60, centerZ + scanRadius,
            "camp_build",
            stripCount
        );

        const finalProbes = [];
        const step = 24;
        for (let x = centerX - scanRadius; x <= centerX + scanRadius; x += step) {
            for (let z = centerZ - scanRadius; z <= centerZ + scanRadius; z += step) {
                finalProbes.push({ x, y: centerY, z });
            }
        }
        const ready = await waitUntilAllLoaded(dimension, finalProbes, 60);
        const areaMs = now() - tArea;

        if (!ready) {
            console.warn(`[camp] Final load check failed ... total=${areaMs}ms strips=${stripCount}`);
            return { placed: false };
        }
        for (let i = 0; i < 4; i++) await nextTick();

        console.warn(
            `[camp] AREA loaded size=${requestedSize.key} span=${loadSpan} ` +
            `strips=${stripCount} areaMs=${areaMs}ms slotMs=${slotMs}ms`
        );

        if (isPlayerNearby(dimension, centerX, centerY, centerZ, 500)) {
            return { placed: false, reason: "player_nearby" };
        }

        // style / pools must be chosen before planning, because planning now uses real structure sizes
        let biomeId = "plains";
        try {
            biomeId = dimension.getBiome({ x: centerX, y: centerY, z: centerZ })?.id ?? "plains";
        } catch { }

        const styleKey = pickStyle(biomeId);
        const foundationBlock = DEFAULT_SUPPORT_BLOCK;
        const activePools = buildActivePools(styleKey);
        const poolQueues = createPoolQueues(activePools);

        // ---- plan / terrain validation ----
        const tPlan = now();
        const candidateSizes = getCandidateSizes(requestedSize);
        const groundCache = new Map();
        const choice = await chooseCampPlan(
            dimension,
            centerX,
            centerY,
            centerZ,
            candidateSizes,
            groundCache,
            activePools
        );
        const planMs = now() - tPlan;

        if (!choice.ok) {
            console.warn(`[camp] FAIL: ${choice.reason} planMs=${planMs}ms`);
            return { placed: false };
        }
        const { plan } = choice;



        const halfD = Math.floor(plan.size.diameter / 2) + TOWER_MAX_FOOTPRINT + DEFOREST_PAD;

        if (isVillageNearby(dimension, centerX, centerY, centerZ, halfD + 15)) {
            console.warn(`[CampBuilder] Skipped camp at ${centerX},${centerY},${centerZ} — village nearby.`);
            return { placed: false, reason: "village_nearby" };
        }

        // ---- deforest ----
        const tDeforest = now();
        await deforestAreaForPlan(dimension, plan, centerX, centerY, centerZ);
        const deforestMs = now() - tDeforest;

        // ---- platform + pillars ----
        const tPlatform = now();
        const minAllowedPlatformY = plan.center.y - MAX_STRUCTURE_Y_DELTA;
        let platformY = plan.center.y;
        for (const spot of plan.validStructureSpots) {
            const top = getGroundY(dimension, spot.x, spot.z, plan.center.y, groundCache);
            if (top.ok && top.y < platformY) platformY = top.y;
        }
        platformY = Math.max(minAllowedPlatformY, platformY);

        await placeInteriorPlatform(dimension, plan, platformY);
        await placeInteriorPlatformPillars(dimension, plan, platformY);
        const platformMs = now() - tPlatform;

        // revalidate invalid spots (usually cheap)
        const tReval = now();
        for (const spot of plan.invalidStructureSpots) {
            const top = getGroundY(dimension, spot.x, spot.z, plan.center.y);
            if (!top.ok) continue;
            if (isLiquidType(top.typeId)) continue;
            if (Math.abs(top.y - plan.center.y) > MAX_STRUCTURE_Y_DELTA) continue;

            const baseY = top.y + 1;
            const cornerSupport = structureCornersHaveSupport(
                dimension,
                spot.x,
                baseY,
                spot.z,
                spot.fw,
                spot.fd
            );

            if (!cornerSupport.ok) continue;

            plan.validStructureSpots.push({
                ...spot,
                suitable: true,
                y: top.y,
                blockTypeId: top.typeId,
            });
        }
        const revalMs = now() - tReval;

        // ---- walls / gates / towers / structs (you already have these) ----
        const t0 = now();
        for (let li = 0; li < plan.wallLayers.length; li++) {
            await placeWalls(dimension, plan, foundationBlock, platformY, plan.wallLayers[li]);
        }
        const wallMs = now() - t0;

        const tGates = now();
        await placeGates(dimension, plan, platformY);
        const gateMs = now() - tGates;

        const t1 = now();
        await placeTowers(dimension, plan, foundationBlock, platformY, activePools, poolQueues);
        const towerMs = now() - t1;

        const t2 = now();
        await placeStructures(dimension, plan, activePools, poolQueues, platformY);
        const structMs = now() - t2;

        const tDrops = now();
        await clearDropsInArea(
            dimension,
            centerX - halfD, centerY - MAX_STRUCTURE_Y_DELTA - 10, centerZ - halfD,
            centerX + halfD, centerY + 70, centerZ + halfD
        );
        const dropsMs = now() - tDrops;

        const totalMs = now() - start;
        const accounted =
            slotMs + areaMs + planMs + deforestMs + platformMs + revalMs +
            wallMs + gateMs + towerMs + structMs + dropsMs;
        const unaccounted = totalMs - accounted;

        console.warn(
            `[camp] DONE requested=${requestedSize.key} actual=${plan.size.key} in ${totalMs}ms | ` +
            `slot=${slotMs} area=${areaMs} plan=${planMs} deforest=${deforestMs} ` +
            `platform=${platformMs} reval=${revalMs} ` +
            `walls=${wallMs} gates=${gateMs} towers=${towerMs} structs=${structMs} ` +
            `drops=${dropsMs} unaccounted=${unaccounted}`
        );

        return { placed: true, ms: totalMs };

    } catch (e) {
        console.warn(`[camp] ERROR: ${e}`);
        return { placed: false };
    } finally {
        if (persistentAreas) removeTickingArea(dimension, persistentAreas);
        releaseBuildSlot();
    }
}