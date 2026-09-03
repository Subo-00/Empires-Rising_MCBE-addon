
// The script assumes structure origin is lower north-west corner.
// Structure ID format: subo:camp_<style>_<size>_<index>_<W>x<H>x<D>
export const STYLE_POOLS = {
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
export const BIOME_STYLE_MAP = [
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
export const STYLE_WEIGHTS = {
    generic: 40,
    samurai: 2,
    clay: 2,
    ice: 0,
    jungle: 0,
    swamp: 0,
};

export const CAMP_SIZES = [
    { key: "very_small", label: "Very Small Outpost", diameter: 27, wallHeight: 4, towerSpacing: 28, supportRadius: 1, weight: 1 },
    { key: "small", label: "Small Camp", diameter: 39, wallHeight: 5, towerSpacing: 29, supportRadius: 1, weight: 1 },
    { key: "medium", label: "Medium Camp", diameter: 69, wallHeight: 6, towerSpacing: 30, supportRadius: 2, weight: 10 },
    { key: "big", label: "Big Camp", diameter: 99, wallHeight: 7, towerSpacing: 30, supportRadius: 3, weight: 10 },
    { key: "very_big", label: "Very Big Camp", diameter: 135, wallHeight: 8, towerSpacing: 31, supportRadius: 3, weight: 25 },
    { key: "huge", label: "Huge Settlement", diameter: 205, wallHeight: 10, towerSpacing: 31, supportRadius: 4, weight: 18 },
];

export const CAMP_SHAPES = [
    { key: "square", label: "Square", weight: 1.15 },
    { key: "rectangle", label: " ", weight: 1.0 },
    { key: "circle", label: "Circle", weight: 0.9 },
];

// Multiple possible required layouts per size.
// One of them is chosen randomly for every camp.
export const REQUIRED_STRUCTURES = {
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
export const EXTRA_STRUCTURE_ATTEMPTS = {
    very_small: 2,
    small: 6,
    medium: 15,
    big: 24,
    very_big: 33,
    huge: 40,
};

// Extra structures only; boss is intentionally not included.
export const EXTRA_POOL_CANDIDATES = {
    very_small: ["small", "tower", "tiny", "small_tower"],
    small: ["small", "tower", "tiny", "small_tower"],
    medium: ["medium", "small", "tower", "tiny", "small_tower"],
    big: ["big", "medium", "small", "tower", "tiny", "small_tower"],
    very_big: ["big", "medium", "small", "tower", "tiny", "small_tower"],
    huge: ["big", "medium", "small", "tower", "tiny", "small_tower"],
};

export const EXTRA_POOL_WEIGHTS = {
    big: 10,
    medium: 7,
    small: 3,
    tower: 2,
    tiny: 1,
    small_tower: 1,
};

// Structure Helpers

export function pickStyle(biomeId) {
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
export function buildActivePools(styleKey) {
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