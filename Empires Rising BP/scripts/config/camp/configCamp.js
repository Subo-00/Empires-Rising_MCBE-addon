
// Minimum distance in blocks to keep from the region border when picking
// a random spawn candidate. Set to half the max village width so that no
// village can ever overlap into an adjacent region.
export const REGION_BORDER_PADDING = 110;

// Region size in chunks. 50x50 chunks = 800x800 blocks per region. Bigger regions = less camps placed worldwide.
export const REGION_SIZE = 90;

// How many regions outward from the player's current region to scan.
// 1 = a 3x3 region grid centered on the player, = 9 regions per player.
export const REGION_SCAN_RADIUS = 1;

// Maximum ticking areas we allow ourselves to use globally
// MCBE hard limit is 10; we cap at 9 to leave 1 slot of headroom.
export const _MAX_REGION_TICKING_AREAS = 9;

export const MIN_BUILD_Y = -64;
export const MAX_BUILD_Y = 319;

export const TERRAIN_SCAN_UP = 90;
export const TERRAIN_SCAN_DOWN = 110;

export const MAX_STRUCTURE_Y_DELTA = 20; // How much higher or lower a structure can spawn from the camps ceter Y

export const MAX_LOAD_WAIT_TICKS = 200;   // How long to wait for a chunk to load when creating a TA
export const COMMANDS_PER_TICK = 220;

export const DEFOREST_PAD = 3;
export const TOWER_MAX_FOOTPRINT = 15;

export const WALL_TOWER_OUTSET = 3; // blocks outside the wall perimeter
export const TOWER_NEGATIVE_Y_ALLOWANCE = 25 // how much the outside towers can go under the interior platform

export const INTERIOR_PILLAR_SPACING = 10; // blocks between interior platform edge pillars

// Minimum clearance from the inner face of the outermost wall.
export const WALL_CLEARANCE = 4;          // base distance from wall
export const STRUCTURE_GAP = 2;                 // minimum XZ gap between structure footprints
export const CORNER_EXTRA_CLEARANCE = 2;  // extra padding in corners (rect/square only)
export const MAX_STRUCTURE_CORNER_DROP = 7;     // max allowed drop from structure base Y to solid ground at every corner

export const STRUCTURE_SURROUND_FILL_HEIGHT = 10; // how many blocks above structure Y to fill around it
export const STRUCTURE_SURROUND_BLOCK = "minecraft:deepslate_bricks"; // block used for the surround fill

export const WALL_BLOCK = "minecraft:deepslate_tiles";
export const WALL_CAP_BLOCK = "minecraft:chiseled_deepslate";
export const INTERIOR_PLATFORM_BLOCK = "minecraft:deepslate_bricks";
export const DEFAULT_SUPPORT_BLOCK = "minecraft:deepslate_bricks";
export const FOUNDATION_PILLAR_BLOCK = "minecraft:chiseled_deepslate";

export const GATE_STRUCTURE_ID = "subo:gate"; // change if your .mcstructure has a different name/namespace
export const GATE_WIDTH = 4;   // along the wall
export const GATE_DEPTH = 1;   // through the wall

// Minimum valid spot ratio required before a size is even considered
export const MIN_VALID_RATIO = {
    very_small: 1.0,
    small: 0.75,
    medium: 0.75,
    big: 0.65,
    very_big: 0.55,
    huge: 0.55,
};

// How many gates to place (sides chosen randomly)
export const GATE_COUNT = {
    very_small: 1,
    small: 1,
    medium: 2,
    big: 2,
    very_big: 3,
    huge: 4,
};

export const MAX_TICKING_AREAS = 6;
export const MAX_TA_SLOTS_PER_BUILD = 3;
export const MAX_CONCURRENT_BUILDS = 3;

// Rectangle camps are this fraction as deep (Z) as they are wide (X),
// with a hard minimum depth so tiny camps still fit structures.
export const RECT_DEPTH_RATIO = 0.68;
export const RECT_MIN_DEPTH = 13;

export const WALL_LAYER_SPACING = 1; // Block gap between consecutive wall rings

// How many wall rings each camp size gets (innermost = ring 0, outermost = ring N-1).
// Rings are spaced WALL_LAYER_SPACING blocks apart (center-to-center radius difference).
export const WALL_LAYER_COUNT = {
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
export const TA_SAFE_MAX_SPAN = [
    { strips: 1, maxSpan: 145 },
    { strips: 2, maxSpan: 193 },
    { strips: 3, maxSpan: 241 },
];
