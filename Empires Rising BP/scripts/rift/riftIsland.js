import { system, world, ItemStack } from "@minecraft/server";
import {
  DIMENSION_ID,
  ISLAND_SPACING,
} from "../config/riftConfig.js";

export { getNextRiftId, ensureIsland, freeRiftId };

// ────────────────────────────────────────────────
//  ID management (unchanged)
// ────────────────────────────────────────────────
function getFreeRiftIds() {
  try {
    const raw = world.getDynamicProperty("subo:free_rift_ids");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveFreeRiftIds(list) {
  world.setDynamicProperty("subo:free_rift_ids", JSON.stringify(list));
}

function freeRiftId(id) {
  if (!id) return;
  const free = getFreeRiftIds();
  if (!free.includes(id)) {
    free.push(id);
    free.sort((a, b) => a - b);
    saveFreeRiftIds(free);
  }
  // also un-mark so the next ensureIsland for this ID will regenerate
  unmarkIslandGenerated(id);
}

function getNextRiftId() {
  const free = getFreeRiftIds();
  if (free.length > 0) {
    const id = free.shift();
    saveFreeRiftIds(free);
    return id;
  }

  const obj =
    world.scoreboard.getObjective("rift_counter") ??
    world.scoreboard.addObjective("rift_counter", "Rift Counter");

  let score = 0;
  try {
    score = obj.getScore("next_id") ?? 0;
  } catch { }
  obj.setScore("next_id", score + 1);
  return score + 1;
}

// ────────────────────────────────────────────────
//  Generated-island tracking (no terrain delete needed)
// ────────────────────────────────────────────────
function getGeneratedSet() {
  try {
    const raw = world.getDynamicProperty("subo:generated_rift_islands");
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveGeneratedSet(set) {
  world.setDynamicProperty("subo:generated_rift_islands", JSON.stringify([...set]));
}

function isIslandGenerated(riftId) {
  return getGeneratedSet().has(riftId);
}

function markIslandGenerated(riftId) {
  const s = getGeneratedSet();
  s.add(riftId);
  saveGeneratedSet(s);
}

function unmarkIslandGenerated(riftId) {
  const s = getGeneratedSet();
  if (s.delete(riftId)) saveGeneratedSet(s);
}

// ────────────────────────────────────────────────
//  Island position (unchanged)
// ────────────────────────────────────────────────
function getIslandPos(riftId) {
  let x = 0,
    z = 0;
  if (riftId > 1) {
    const layer = Math.ceil((Math.sqrt(riftId) - 1) / 2);
    const leg = riftId - (2 * layer - 1) ** 2;
    const side = Math.floor(leg / (layer * 2));
    const offset = leg % (layer * 2);

    if (side === 0) {
      x = layer;
      z = -layer + offset;
    } else if (side === 1) {
      x = layer - offset;
      z = layer;
    } else if (side === 2) {
      x = -layer;
      z = layer - offset;
    } else {
      x = -layer + offset;
      z = -layer;
    }
  }
  return { x: x * ISLAND_SPACING, y: 180, z: z * ISLAND_SPACING };
}

// ────────────────────────────────────────────────
//  SKELETON MAPS – fill these later
// ────────────────────────────────────────────────

/** Possible player spawn points relative to island origin (base.x, base.y, base.z) */
const SPAWN_OFFSETS = [
  { x: 67, y: 2, z: 42 },
];

/** Possible chest locations relative to island origin */
const CHEST_OFFSETS = [
  { x: 69, y: 2, z: 42 },
  // { x: 45, y: 2, z: 30 },
  // { x: 80, y: 1, z: 60 },
  // add as many as you want…
];

// Chance that a given CHEST_OFFSET actually receives a chest
const CHEST_SPAWN_CHANCE = 0.65;

// ────────────────────────────────────────────────
//  Loot tables (3 tiers) – expand with real items
// ────────────────────────────────────────────────
const LOOT_TIER_1 = [
  // common
  { id: "minecraft:iron_ingot", min: 1, max: 3 },
  { id: "minecraft:coal", min: 2, max: 6 },
  // …
];

const LOOT_TIER_2 = [
  // uncommon
  { id: "minecraft:gold_ingot", min: 1, max: 2 },
  { id: "minecraft:diamond", min: 1, max: 1 },
  // …
];

const LOOT_TIER_3 = [
  // rare
  { id: "minecraft:netherite_scrap", min: 1, max: 1 },
  { id: "minecraft:enchanted_golden_apple", min: 1, max: 1 },
  // …
];

const LOOT_TIERS = [LOOT_TIER_1, LOOT_TIER_2, LOOT_TIER_3];

// ────────────────────────────────────────────────
//  Helper: fill a chest with random loot from a tier
// ────────────────────────────────────────────────
function fillChestWithLoot(container, tierIndex) {
  const table = LOOT_TIERS[tierIndex];
  if (!table || !container) return;

  // simple: put 2–5 random stacks
  const stacks = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < stacks; i++) {
    const entry = table[Math.floor(Math.random() * table.length)];
    const count =
      entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
    const slot = Math.floor(Math.random() * container.size);
    try {
      container.setItem(slot, new ItemStack(entry.id, count));
    } catch { }
  }
}

// ────────────────────────────────────────────────
//  Main generation
// ────────────────────────────────────────────────
async function ensureIsland(riftId) {
  const dim = world.getDimension(DIMENSION_ID);
  const base = getIslandPos(riftId);

  // Default spawn (used both when already generated and after generation)
  let spawn = { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 };
  if (SPAWN_OFFSETS.length > 0) {
    const s = SPAWN_OFFSETS[Math.floor(Math.random() * SPAWN_OFFSETS.length)];
    spawn = {
      x: base.x + s.x + 0.5,
      y: base.y + (s.y ?? 1),
      z: base.z + s.z + 0.5,
    };
  }

  // ---- already generated for this riftId? (re-open of same port) ----
  if (isIslandGenerated(riftId)) {
    return {
      spawn,
      pouchCount: -1, // already exists – do not overwrite loot / pouch counters
    };
  }

  // ---- create ticking area for the whole fortress ----
  const width = 150; // adjust to your real structure size
  const depth = 150;
  const taId = `rift_gen_${riftId}`;
  let areaCreated = false;

  try {
    const options = {
      dimension: dim,
      from: { x: base.x, y: base.y - 5, z: base.z },
      to: { x: base.x + width - 1, y: base.y + 20, z: base.z + depth - 1 },
    };
    if (world.tickingAreaManager.hasCapacity(options)) {
      await world.tickingAreaManager.createTickingArea(taId, options);
      areaCreated = true;
    }
  } catch { }

  // ---- load structure pieces (overwrites whatever was there) ----
  const pieces = [
    { name: "rift_fort:0_50_rift_fort", x: 0, z: 50 },
    { name: "rift_fort:50_0_rift_fort", x: 50, z: 0 },
    { name: "rift_fort:55_50_rift_fort", x: 55, z: 50 },
    { name: "rift_fort:59_105_rift_fort", x: 59, z: 105 },
    { name: "rift_fort:100_55_rift_fort", x: 100, z: 55 },
    // add the rest of your pieces here
  ];

  // runCommand must be delayed one tick after the ticking area is ready
  await system.waitTicks(1);

  for (const p of pieces) {
    try {
      dim.runCommand(
        `structure load ${p.name} ${base.x + p.x} ${base.y} ${base.z + p.z}`
      );
    } catch (e) {
      console.warn(`[rift] Failed to load ${p.name}: ${e}`);
    }
  }

  // ---- decide which chest positions will actually spawn ----
  // Rules:
  //   • Always at least min(10, available offsets) chests
  //   • Exactly 3–5 of those chests get a glitch pouch (or all of them if fewer chests exist)
  //   • Even with only 1 offset the single chest is forced + receives a pouch
  const offsets = [...CHEST_OFFSETS];
  // Fisher-Yates shuffle for randomness
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
  }

  const minChests = Math.min(10, offsets.length);
  const activeChests = offsets.slice(0, minChests); // always take at least this many

  // Optionally add extra chests beyond the minimum with the normal chance
  for (let i = minChests; i < offsets.length; i++) {
    if (Math.random() < CHEST_SPAWN_CHANCE) {
      activeChests.push(offsets[i]);
    }
  }

  // ---- guarantee exactly 3–5 pouches (clamped to number of chests) ----
  const pouchTarget = Math.min(
    3 + Math.floor(Math.random() * 3), // 3, 4 or 5
    activeChests.length
  );
  const pouchSlots = new Set();
  while (pouchSlots.size < pouchTarget) {
    pouchSlots.add(Math.floor(Math.random() * activeChests.length));
  }

  let placedPouches = 0;

  for (let i = 0; i < activeChests.length; i++) {
    const off = activeChests[i];
    const bx = base.x + off.x;
    const by = base.y + (off.y ?? 1);
    const bz = base.z + off.z;

    const block = dim.getBlock({ x: bx, y: by, z: bz });
    if (!block) continue;

    block.setType("minecraft:chest");
    const inv = block.getComponent("inventory")?.container;
    if (!inv) continue;

    // random loot tier
    const tier = Math.floor(Math.random() * 3);
    fillChestWithLoot(inv, tier);

    // glitch pouch?
    if (pouchSlots.has(i)) {
      const pouch = new ItemStack("subo:glitch_pouch", 1);
      pouch.setLore([
        "§5Glitch Pouch",
        `§8Rift #${riftId}`,
        "§7Right-click to extract",
      ]);
      // try to put it in a free slot (or slot 0)
      try {
        inv.setItem(0, pouch);
      } catch {
        // fallback – just force it
        inv.setItem(Math.floor(Math.random() * inv.size), pouch);
      }
      placedPouches++;
    }
  }

  // ---- clean up ticking area ----
  if (areaCreated) {
    try {
      world.tickingAreaManager.removeTickingArea(taId);
    } catch { }
  }

  // mark so subsequent ensures for the same riftId skip generation
  markIslandGenerated(riftId);

  return {
    spawn,
    pouchCount: placedPouches,
  };
}

// ────────────────────────────────────────────────
//  Delete (kept almost the same)
// ────────────────────────────────────────────────
async function deleteIsland(riftId) {
  const dim = world.getDimension(DIMENSION_ID);
  const base = getIslandPos(riftId);
  const radius = 90;
  const areaId = `rift_del_${riftId}`;
  let areaCreated = false;

  try {
    const options = {
      dimension: dim,
      from: { x: base.x - radius, y: base.y - 10, z: base.z - radius },
      to: { x: base.x + radius, y: base.y + 30, z: base.z + radius },
    };
    if (world.tickingAreaManager.hasCapacity(options)) {
      await world.tickingAreaManager.createTickingArea(areaId, options);
      areaCreated = true;
    }
  } catch { }

  for (let y = base.y - 5; y <= base.y + 25; y++) {
    for (let x = base.x - radius; x <= base.x + radius; x++) {
      for (let z = base.z - radius; z <= base.z + radius; z++) {
        const b = dim.getBlock({ x, y, z });
        if (b && b.typeId !== "minecraft:air") b.setType("minecraft:air");
      }
    }
    await system.waitTicks(1);
  }

  dim.getBlock({ x: base.x, y: base.y - 1, z: base.z })?.setType("minecraft:air");

  if (areaCreated) {
    try {
      world.tickingAreaManager.removeTickingArea(areaId);
    } catch { }
  }

  freeRiftId(riftId);
}