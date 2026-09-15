import { system, world, ItemStack, BlockPermutation } from "@minecraft/server";
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
      { x: 73, y: 156 - 146, z: 14, facing: "west" },
      { x: 73, y: 156 - 146, z: 32, facing: "west" },
      { x: 74, y: 161 - 146, z: 22, facing: "west" },
      { x: 66, y: 166 - 146, z: 11, facing: "east" },
      { x: 67, y: 167 - 146, z: 33, facing: "north" },
      { x: 72, y: 171 - 146, z: 11, facing: "west" },
      { x: 70, y: 171 - 146, z: 29, facing: "south" },
      { x: 80, y: 169, z: 42, facing: "west" },
      { x: 54, y: 169, z: 46, facing: "east" },
      
      { x: 14, y: 151, z: 67, facing: "south" },
      { x: 43, y: 151, z: 58, facing: "south" },
      { x: 43, y: 151, z: 70, facing: "north" },
      { x: 34, y: 169, z: 81, facing: "east" },
      { x: 13, y: 151, z: 98, facing: "east" },

      { x: 63, y: 172, z: 60, facing: "east" },
      { x: 71, y: 172, z: 60, facing: "west" },
      { x: 71, y: 172, z: 68, facing: "west" },
      { x: 63, y: 172, z: 68, facing: "east" },
      { x: 63, y: 172, z: 99, facing: "east" },
      { x: 71, y: 172, z: 99, facing: "west" },
      { x: 71, y: 172, z: 91, facing: "west" },
      { x: 63, y: 172, z: 91, facing: "east" },
      { x: 91, y: 171, z: 70, facing: "north" },
      { x: 91, y: 171, z: 58, facing: "south" },
      { x: 67, y: 162, z: 91, facing: "south" },
      { x: 67, y: 162, z: 68, facing: "north" },
      
      { x: 124, y: 192, z: 64, facing: "east" },
      { x: 123, y: 151, z: 91, facing: "east" },
      { x: 121, y: 151, z: 68, facing: "east" },
      
      { x: 64, y: 151, z: 136, facing: "north" },
    ],
    beaconOffset: {x: 67, z: 131},  // replace roof with glass here
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
      { x: 78, y: 14, z: 58 },
    ],
    chestOffsets: [
      { x: 16, y: 30, z: 10, facing: "south" },
      { x: 1, y: 30, z: 26, facing: "east" },
      { x: 27, y: 51, z: 20, facing: "south" },
      { x: 24, y: 27, z: 19, facing: "south" },
      { x: 33, y: 25, z: 34, facing: "south" },
      { x: 14, y: 25, z: 36, facing: "east" },
      { x: 17, y: 28, z: 32, facing: "south" },
      { x: 17, y: 26, z: 24, facing: "south" },
      { x: 15, y: 13, z: 31, facing: "north" },
      { x: 15, y: 13, z: 18, facing: "south" },
      { x: 38, y: 4, z: 11, facing: "south" },
      { x: 2, y: 4, z: 22, facing: "east" },
      { x: 2, y: 4, z: 28, facing: "east" },
      { x: 19, y: 4, z: 31, facing: "north" },
      { x: 40, y: 3, z: 38, facing: "north" },
      
      { x: 71, y: 23, z: 36, facing: "south" },
      { x: 73, y: 23, z: 26, facing: "west" },
      { x: 70, y: 19, z: 40, facing: "north" },
      { x: 75, y: 13, z: 29, facing: "west" },
      { x: 66, y: 13, z: 11, facing: "south" },
      { x: 66, y: 8, z: 10, facing: "south" },
      
      { x: 15, y: 3, z: 74, facing: "west" },
      { x: 13, y: 3, z: 98, facing: "west" },
      { x: 10, y: 44, z: 102, facing: "west" },
      { x: 35, y: 21, z: 88, facing: "west" },
      { x: 44, y: 23, z: 77, facing: "north" },
      { x: 44, y: 23, z: 65, facing: "south" },
      
      { x: 84, y: 21, z: 53, facing: "west" },
      { x: 64, y: 24, z: 67, facing: "east" },
      { x: 64, y: 24, z: 75, facing: "east" },
      { x: 72, y: 24, z: 75, facing: "west" },
      { x: 101, y: 21, z: 84, facing: "west" },
      { x: 92, y: 23, z: 65, facing: "south" },
      { x: 92, y: 23, z: 77, facing: "north" },
      { x: 72, y: 14, z: 71, facing: "west" },

      { x: 122, y: 3, z: 71, facing: "east" },
      { x: 124, y: 3, z: 102, facing: "east" },
      { x: 127, y: 44, z: 102, facing: "east" },

      { x: 72, y: 24, z: 106, facing: "west" },
      { x: 72, y: 24, z: 98, facing: "west" },
      { x: 64, y: 24, z: 98, facing: "east" },
      { x: 64, y: 24, z: 106, facing: "east" },
      { x: 68, y: 14, z: 98, facing: "south" },
      { x: 70, y: 3, z: 142, facing: "north" },
      { x: 66, y: 23, z: 141, facing: "north" },
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

    // Default to "north" if no facing is specified
    const facing = off.facing ?? "north";

    const perm = BlockPermutation.resolve("minecraft:chest", {
      "minecraft:cardinal_direction": facing
    });
    block.setPermutation(perm);

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