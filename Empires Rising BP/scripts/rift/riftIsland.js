import { system, world, ItemStack } from "@minecraft/server";
import {
  DIMENSION_ID,
  ISLAND_SPACING,
} from "../config/riftConfig.js";
import { getNum, setNum } from "./riftHelpers.js";

export { getNextRiftId, ensureIsland, freeRiftId };

// ────────────────────────────────────────────────
//  Surrounding Box
// ────────────────────────────────────────────────
const BOTTOM_BLOCK = "magma";          // or "minecraft:magma_block"
const WALL_BLOCK = "netherrack";

const BOX_SIZE = 160;         // exactly 100 chunks when aligned
const BOX_HEIGHT_OFFSET = 75;          // ±75 from fortress centre
const FORTRESS_Y_OFFSET = -40;       // fortress/chests/spawns y offset inside the box

// ────────────────────────────────────────────────
//  Loot tables (shared by both layouts)
// ────────────────────────────────────────────────
const LOOT_TIER_1 = [
  { id: "minecraft:iron_ingot", min: 1, max: 3 },
  { id: "minecraft:coal", min: 2, max: 6 },
];
const LOOT_TIER_2 = [
  { id: "minecraft:gold_ingot", min: 1, max: 2 },
  { id: "minecraft:diamond", min: 1, max: 1 },
];
const LOOT_TIER_3 = [
  { id: "minecraft:netherite_scrap", min: 1, max: 1 },
  { id: "minecraft:enchanted_golden_apple", min: 1, max: 1 },
];
const LOOT_TIERS = [LOOT_TIER_1, LOOT_TIER_2, LOOT_TIER_3];

const CHEST_SPAWN_CHANCE = 0.65;

// ────────────────────────────────────────────────
//  LAYOUT DEFINITIONS
//  Each layout owns its own:
//    • fortress offset (how far the whole build is shifted from box origin)
//    • structure pieces
//    • player spawn points
//    • chest points
// ────────────────────────────────────────────────
const LAYOUTS = [
  // ── Layout 1 ──────────────────────────────
  {
    id: 0,
    offsetX: 10,
    offsetZ: 8,
    pieces: [
      { name: "rift_fort:0_50_rift_fort", x: 0, z: 50 },
      { name: "rift_fort:50_0_rift_fort", x: 50, z: 0 },
      { name: "rift_fort:55_50_rift_fort", x: 55, z: 50 },
      { name: "rift_fort:59_105_rift_fort", x: 59, z: 105 },
      { name: "rift_fort:100_55_rift_fort", x: 100, z: 55 },
    ],
    spawnOffsets: [
      { x: 67, y: 2, z: 42 },
    ],
    chestOffsets: [
      { x: 69, y: 2, z: 42 },
      // { x: 45, y: 2, z: 30 },
      // { x: 80, y: 1, z: 60 },
    ],
  },

  // ── Layout 2 ──────────────────────────────
  {
    id: 1,
    offsetX: 10,
    offsetZ: 8,
    pieces: [
      { name: "rift_fort_2:0_0_rift_fort_2", x: 0, z: 0 },
      { name: "rift_fort_2:0_50_rift_port_2", x: 0, z: 50 },
      { name: "rift_fort_2:100_50_rift_port_2", x: 100, z: 50 },
      { name: "rift_fort_2:50_0_rift_port_2", x: 50, z: 0 },
      { name: "rift_fort_2:50_100_rift_port_2", x: 50, z: 100 },
      { name: "rift_fort_2:50_50_rift_port_2", x: 50, z: 50 },
    ],
    spawnOffsets: [
      { x: 70, y: 2, z: 70 },
    ],
    chestOffsets: [
      { x: 72, y: 2, z: 70 },
    ],
  },
];

// ────────────────────────────────────────────────
//  Taken-ID tracking (scoreboard only)
// ────────────────────────────────────────────────
const TAKEN_OBJ = "rift_taken";

function getTakenObjective() {
  return world.scoreboard.getObjective(TAKEN_OBJ)
    ?? world.scoreboard.addObjective(TAKEN_OBJ, "Rift Taken IDs");
}

function getTakenIds() {
  const obj = getTakenObjective();
  const taken = new Set();
  for (const p of obj.getParticipants()) {
    const n = Number(p.displayName);
    if (Number.isInteger(n) && n > 0) taken.add(n);
  }
  return taken;
}

function isIslandGenerated(riftId) {
  return getTakenIds().has(riftId);
}

function markIslandGenerated(riftId) {
  getTakenObjective().setScore(String(riftId), 1);
}

function freeRiftId(id) {
  if (!id) return;
  try {
    getTakenObjective().removeParticipant(String(id));
  } catch { }
}

function getNextRiftId() {
  const taken = getTakenIds();
  if (taken.size === 0) return 1;

  const sorted = [...taken].sort((a, b) => a - b);
  // gap-fill: if the highest ID is not equal to the count, a hole exists
  if (sorted[sorted.length - 1] !== sorted.length) {
    for (let i = 1; i <= sorted[sorted.length - 1]; i++) {
      if (!taken.has(i)) return i;
    }
  }
  // contiguous → next sequential
  return sorted[sorted.length - 1] + 1;
}

// ────────────────────────────────────────────────
//  Island position
// ────────────────────────────────────────────────
function getIslandPos(riftId) {
  let x = 0, z = 0;
  if (riftId > 1) {
    const layer = Math.ceil((Math.sqrt(riftId) - 1) / 2);
    const leg = riftId - (2 * layer - 1) ** 2;
    const side = Math.floor(leg / (layer * 2));
    const offset = leg % (layer * 2);
    if (side === 0) { x = layer; z = -layer + offset; }
    else if (side === 1) { x = layer - offset; z = layer; }
    else if (side === 2) { x = -layer; z = layer - offset; }
    else { x = -layer + offset; z = -layer; }
  }
  return { x: x * ISLAND_SPACING, y: 50, z: z * ISLAND_SPACING };
}

// ────────────────────────────────────────────────
//  Helper: fill a chest
// ────────────────────────────────────────────────
function fillChestWithLoot(container, tierIndex) {
  const table = LOOT_TIERS[tierIndex];
  if (!table || !container) return;
  const stacks = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < stacks; i++) {
    const entry = table[Math.floor(Math.random() * table.length)];
    const count = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
    const slot = Math.floor(Math.random() * container.size);
    try { container.setItem(slot, new ItemStack(entry.id, count)); } catch { }
  }
}

// ────────────────────────────────────────────────
//  Main generation
// ────────────────────────────────────────────────
async function ensureIsland(riftId, entity = null) {
  const dim = world.getDimension(DIMENSION_ID);
  const base = getIslandPos(riftId);

  // ── choose / restore layout (stored on the entity) ───────────────────
  let layoutIndex = entity ? getNum(entity, "layout:", -1) : -1;
  if (layoutIndex < 0 || layoutIndex >= LAYOUTS.length) {
    // first time (or missing data) → pick randomly and persist on entity
    layoutIndex = Math.floor(Math.random() * LAYOUTS.length);
    if (entity && entity.isValid) {
      setNum(entity, "layout:", layoutIndex);
    }
  }
  const layout = LAYOUTS[layoutIndex];

  // ── spawn point (always calculated from the chosen layout) ───
  let spawn = {
    x: base.x + layout.offsetX + 0.5,
    y: base.y + FORTRESS_Y_OFFSET + 1,
    z: base.z + layout.offsetZ + 0.5,
    rotation: { x: 0, y: 0 }
  };
  if (layout.spawnOffsets.length > 0) {
    const s = layout.spawnOffsets[Math.floor(Math.random() * layout.spawnOffsets.length)];
    spawn = {
      x: base.x + layout.offsetX + s.x + 0.5,
      y: base.y + FORTRESS_Y_OFFSET + (s.y ?? 1),
      z: base.z + layout.offsetZ + s.z + 0.5,
      rotation: {
        x: s.pitch ?? 0,
        y: s.yaw ?? 0
      }
    };
  }

  // ── already generated? just return the spawn ─────────────────
  if (isIslandGenerated(riftId)) {
    return { spawn, pouchCount: -1 };
  }

  // ── create ticking area (160×160 → exactly 100 chunks) ───────
  const taId = `rift_gen_${riftId}`;
  let areaCreated = false;
  try {
    const options = {
      dimension: dim,
      from: { x: base.x, y: base.y - BOX_HEIGHT_OFFSET, z: base.z },
      to: { x: base.x + BOX_SIZE - 1, y: base.y + BOX_HEIGHT_OFFSET, z: base.z + BOX_SIZE - 1 },
    };
    if (world.tickingAreaManager.hasCapacity(options)) {
      await world.tickingAreaManager.createTickingArea(taId, options);
      areaCreated = true;
    }
  } catch { }

  await system.waitTicks(1);

  // ── load the chosen layout’s structures ──────────────────────
  for (const p of layout.pieces) {
    try {
      dim.runCommand(
        `structure load ${p.name} ${base.x + layout.offsetX + p.x} ${base.y + FORTRESS_Y_OFFSET} ${base.z + layout.offsetZ + p.z}`
      );
    } catch (e) {
      console.warn(`[rift] Failed to load ${p.name}: ${e}`);
    }
  }

  // ── build the enclosing box ──────────────────────────────────
  const bottomY = base.y - BOX_HEIGHT_OFFSET;
  const topY = base.y + BOX_HEIGHT_OFFSET;
  const maxX = base.x + BOX_SIZE - 1;
  const maxZ = base.z + BOX_SIZE - 1;

  try {
    dim.runCommand(`fill ${base.x} ${bottomY} ${base.z} ${maxX} ${bottomY} ${maxZ} ${BOTTOM_BLOCK}`);
  } catch (e) { console.warn(`[rift] bottom fill failed: ${e}`); }

  try {
    dim.runCommand(`fill ${base.x} ${topY} ${base.z} ${maxX} ${topY} ${maxZ} ${WALL_BLOCK}`);
  } catch (e) { console.warn(`[rift] top fill failed: ${e}`); }

  const wallCmds = [
    `fill ${base.x} ${bottomY + 1} ${base.z} ${maxX} ${topY - 1} ${base.z} ${WALL_BLOCK}`,
    `fill ${base.x} ${bottomY + 1} ${maxZ} ${maxX} ${topY - 1} ${maxZ} ${WALL_BLOCK}`,
    `fill ${base.x} ${bottomY + 1} ${base.z} ${base.x} ${topY - 1} ${maxZ} ${WALL_BLOCK}`,
    `fill ${maxX} ${bottomY + 1} ${base.z} ${maxX} ${topY - 1} ${maxZ} ${WALL_BLOCK}`,
  ];
  for (const cmd of wallCmds) {
    try { dim.runCommand(cmd); } catch (e) { console.warn(`[rift] wall fill failed: ${e}`); }
  }

  await system.waitTicks(1);

  // ── chests from the chosen layout ────────────────────────────
  const offsets = [...layout.chestOffsets];
  for (let i = offsets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
  }

  const minChests = Math.min(10, offsets.length);
  const activeChests = offsets.slice(0, minChests);
  for (let i = minChests; i < offsets.length; i++) {
    if (Math.random() < CHEST_SPAWN_CHANCE) activeChests.push(offsets[i]);
  }

  const pouchTarget = Math.min(3 + Math.floor(Math.random() * 3), activeChests.length);
  const pouchSlots = new Set();
  while (pouchSlots.size < pouchTarget) {
    pouchSlots.add(Math.floor(Math.random() * activeChests.length));
  }

  let placedPouches = 0;
  for (let i = 0; i < activeChests.length; i++) {
    const off = activeChests[i];
    const bx = base.x + layout.offsetX + off.x;
    const by = base.y + FORTRESS_Y_OFFSET + (off.y ?? 1);
    const bz = base.z + layout.offsetZ + off.z;

    const block = dim.getBlock({ x: bx, y: by, z: bz });
    if (!block) continue;

    block.setType("minecraft:chest");
    const inv = block.getComponent("inventory")?.container;
    if (!inv) continue;

    fillChestWithLoot(inv, Math.floor(Math.random() * 3));

    if (pouchSlots.has(i)) {
      const pouch = new ItemStack("subo:glitch_pouch", 1);
      pouch.setLore([
        "§5Glitch Pouch",
        `§8Rift #${riftId}`,
        "§7Right-click to extract",
      ]);
      try { inv.setItem(0, pouch); }
      catch { inv.setItem(Math.floor(Math.random() * inv.size), pouch); }
      placedPouches++;
    }
  }

  // ── clean up ─────────────────────────────────────────────────
  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(taId); } catch { }
  }

  markIslandGenerated(riftId);

  return { spawn, pouchCount: placedPouches };
}