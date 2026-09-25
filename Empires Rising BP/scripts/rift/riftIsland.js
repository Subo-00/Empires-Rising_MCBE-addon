import { system, world, ItemStack, BlockPermutation } from "@minecraft/server";
import {
  RIFT_DIMENSION_ID, ISLAND_SPACING, BOTTOM_BLOCK, WALL_BLOCK,
  BOX_SIZE, BOX_HEIGHT_OFFSET, FORTRESS_Y_OFFSET,
  LAYOUTS, BEACON_OFFSETS
} from "../config/rift/riftConfig.js";
import { getNum, setNum } from "./riftHelpers.js";
import { CHEST_SPAWN_CHANCE, LOOT_TIERS } from "../config/rift/riftChestLoot.js";

export { getNextRiftId, ensureIsland, freeRiftId };


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
  clearPouchCounters(id);
  clearPortLocation(id);
}

function getNextRiftId() {
  const taken = getTakenIds();
  if (taken.size === 0) return { id: 1, shouldBuildBox: true };

  const sorted = [...taken].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1];

  // gap-fill → not a new highest ID
  if (max !== sorted.length) {
    for (let i = 1; i <= max; i++) {
      if (!taken.has(i)) return { id: i, shouldBuildBox: false };
    }
  }

  // contiguous → brand-new highest ID
  return { id: max + 1, shouldBuildBox: true };
}

// ────────────────────────────────────────────────
//  Pouch counters + port location (scoreboard)
// ────────────────────────────────────────────────
const POUCH_TOTAL_OBJ = "rift_pouch_total";
const POUCH_OPENED_OBJ = "rift_pouch_opened";
const PORT_X_OBJ = "rift_port_x";
const PORT_Y_OBJ = "rift_port_y";
const PORT_Z_OBJ = "rift_port_z";

function getOrCreateObj(id, display) {
  return world.scoreboard.getObjective(id)
    ?? world.scoreboard.addObjective(id, display);
}

export function setPouchCounters(riftId, total) {
  if (!riftId || total <= 0) return;
  getOrCreateObj(POUCH_TOTAL_OBJ, "Rift Pouch Total").setScore(String(riftId), total);
  getOrCreateObj(POUCH_OPENED_OBJ, "Rift Pouch Opened").setScore(String(riftId), 0);
}

export function incrementPouchOpened(riftId) {
  if (!riftId) return { total: 0, opened: 0, needDestroy: false };
  const totalObj = getOrCreateObj(POUCH_TOTAL_OBJ, "Rift Pouch Total");
  const openedObj = getOrCreateObj(POUCH_OPENED_OBJ, "Rift Pouch Opened");
  const total = totalObj.getScore(String(riftId)) ?? 0;
  const opened = (openedObj.getScore(String(riftId)) ?? 0) + 1;
  openedObj.setScore(String(riftId), opened);
  return { total, opened, needDestroy: total > 0 && opened >= total };
}

export function clearPouchCounters(riftId) {
  if (!riftId) return;
  try { getOrCreateObj(POUCH_TOTAL_OBJ, "Rift Pouch Total").removeParticipant(String(riftId)); } catch { }
  try { getOrCreateObj(POUCH_OPENED_OBJ, "Rift Pouch Opened").removeParticipant(String(riftId)); } catch { }
}

export function setPortLocation(riftId, loc) {
  if (!riftId || !loc) return;
  getOrCreateObj(PORT_X_OBJ, "Rift Port X").setScore(String(riftId), Math.floor(loc.x));
  getOrCreateObj(PORT_Y_OBJ, "Rift Port Y").setScore(String(riftId), Math.floor(loc.y));
  getOrCreateObj(PORT_Z_OBJ, "Rift Port Z").setScore(String(riftId), Math.floor(loc.z));
}

export function getPortLocation(riftId) {
  if (!riftId) return null;
  const x = getOrCreateObj(PORT_X_OBJ, "Rift Port X").getScore(String(riftId));
  const y = getOrCreateObj(PORT_Y_OBJ, "Rift Port Y").getScore(String(riftId));
  const z = getOrCreateObj(PORT_Z_OBJ, "Rift Port Z").getScore(String(riftId));
  if (x == null || y == null || z == null) return null;
  return { x, y, z };
}

export function clearPortLocation(riftId) {
  if (!riftId) return;
  try { getOrCreateObj(PORT_X_OBJ, "Rift Port X").removeParticipant(String(riftId)); } catch { }
  try { getOrCreateObj(PORT_Y_OBJ, "Rift Port Y").removeParticipant(String(riftId)); } catch { }
  try { getOrCreateObj(PORT_Z_OBJ, "Rift Port Z").removeParticipant(String(riftId)); } catch { }
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
function fillChestWithLoot(container) {
  if (!container) return;

  const totalWeight = LOOT_TIERS.reduce((sum, t) => sum + t.weight, 0);
  const stacks = 4 + Math.floor(Math.random() * 4); // 4–7 stacks (avg ≈ 5.5)

  for (let i = 0; i < stacks; i++) {
    // Independent weighted roll for every stack
    let roll = Math.random() * totalWeight;
    let chosenTier = LOOT_TIERS[0];
    for (const tier of LOOT_TIERS) {
      roll -= tier.weight;
      if (roll <= 0) {
        chosenTier = tier;
        break;
      }
    }

    const entry = chosenTier.items[Math.floor(Math.random() * chosenTier.items.length)];
    const slot = Math.floor(Math.random() * container.size);

    try {
      if (entry.type === "book") {
        const book = new ItemStack("minecraft:enchanted_book", 1);
        const enchComp = book.getComponent("minecraft:enchantable");
        if (enchComp) {
          enchComp.addEnchantment({ type: entry.enchant, level: entry.level });
        }
        container.setItem(slot, book);
      } else {
        const count = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
        container.setItem(slot, new ItemStack(entry.id, count));
      }
    } catch { /* ignore full/invalid slots */ }
  }
}

// ────────────────────────────────────────────────
//  Main generation
// ────────────────────────────────────────────────
async function ensureIsland(riftId, entity = null, shouldBuildBox = true, player) {
  const dim = world.getDimension(RIFT_DIMENSION_ID);
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

  // ── silently remove all entities in the fortress volume (except players) ──
  const center = {
    x: base.x + BOX_SIZE / 2,
    y: base.y,
    z: base.z + BOX_SIZE / 2
  };

  // Sphere that comfortably covers the whole box
  const radius = Math.ceil(Math.sqrt(3) * (BOX_SIZE / 2)) + 8;

  for (const entity of dim.getEntities({
    location: center,
    maxDistance: radius
  })) {
    if (entity.typeId === "minecraft:player") continue;
    try {
      entity.remove();          // silent, no drops / particles / sounds
    } catch { /* already gone or invalid */ }
  }

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

  // ── build the enclosing box ONLY when told to ──
  if (shouldBuildBox) {
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

    // ── place red stained glass at beaconOffset (exact rooftop Y) ──
    for (const offs of BEACON_OFFSETS) {
      const bx = base.x + layout.offsetX + offs.x;
      const bz = base.z + layout.offsetZ + offs.z;
      try {
        const block = dim.getBlock({ x: bx, y: topY, z: bz });
        block.setType("minecraft:red_stained_glass");
      } catch (e) {
        console.warn(`[rift] Failed to place beacon glass: ${e}`);
      }
    }
  }

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

    fillChestWithLoot(inv);

    if (pouchSlots.has(i)) {
      const pouch = new ItemStack("subo:glitch_pouch", 1);
      pouch.setLore([
        "§5Glitch Pouch",
        `§8Rift #${riftId}`,
        "§7Right-click to extract spirits"
      ]);
      try { inv.setItem(0, pouch); }
      catch { inv.setItem(Math.floor(Math.random() * inv.size), pouch); }
      placedPouches++;
    }
  }

  // Persist pouch counters on scoreboard (survives reloads, no entity needed)
  if (placedPouches > 0) {
    setPouchCounters(riftId, placedPouches);
  }

  // ── clean up ─────────────────────────────────────────────────
  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(taId); } catch { }
  }

  markIslandGenerated(riftId);

  return { spawn, pouchCount: placedPouches };
}