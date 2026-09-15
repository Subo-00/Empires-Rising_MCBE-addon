import { system, world, ItemStack, BlockPermutation } from "@minecraft/server";
import {
  DIMENSION_ID, ISLAND_SPACING, BOTTOM_BLOCK, WALL_BLOCK,
  BOX_SIZE, BOX_HEIGHT_OFFSET, FORTRESS_Y_OFFSET,
  LAYOUTS, BEACON_OFFSETS
} from "../config/riftConfig.js";
import { getNum, setNum } from "./riftHelpers.js";
import { CHEST_SPAWN_CHANCE, LOOT_TIERS } from "../config/riftChestLoot.js";

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
async function ensureIsland(riftId, entity = null, shouldBuildBox = true) {
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