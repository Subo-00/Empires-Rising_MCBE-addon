import { system, world, ItemStack } from "@minecraft/server";
import { DIMENSION_ID, ISLAND_SPACING, MAX_ISLAND_LENGTH, MIN_ISLAND_LENGTH } from "../config/riftConfig.js";

export { getNextRiftId, ensureIsland, deleteIsland };

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
  const free = getFreeRiftIds();
  if (!free.includes(id)) {
    free.push(id);
    free.sort((a, b) => a - b);
    saveFreeRiftIds(free);
  }
}

function getNextRiftId() {
  const free = getFreeRiftIds();
  if (free.length > 0) {
    const id = free.shift();
    saveFreeRiftIds(free);
    return id;
  }

  const obj = world.scoreboard.getObjective("rift_counter")
    ?? world.scoreboard.addObjective("rift_counter", "Rift Counter");

  let score = 0;
  try { score = obj.getScore("next_id") ?? 0; } catch { }
  obj.setScore("next_id", score + 1);
  return score + 1;
}

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
  return { x: x * ISLAND_SPACING, y: 180, z: z * ISLAND_SPACING };
}

async function ensureIsland(riftId) {
  const dim = world.getDimension(DIMENSION_ID);
  const base = getIslandPos(riftId);

  const radius = 80;
  const areaId = `rift_gen_${riftId}`;
  let areaCreated = false;

  try {
    const options = {
      dimension: dim,
      from: { x: base.x - radius, y: 40, z: base.z - radius },
      to: { x: base.x + radius, y: 90, z: base.z + radius }
    };
    if (world.tickingAreaManager.hasCapacity(options)) {
      await world.tickingAreaManager.createTickingArea(areaId, options);
      areaCreated = true;
    }
  } catch { }

  const marker = dim.getBlock({ x: base.x, y: base.y - 1, z: base.z });
  if (marker && marker.typeId === "minecraft:bedrock") {
    if (areaCreated) {
      try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
    }
    return {
      spawn: { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 },
      pouchCount: -1   // already generated – do not overwrite pouchTotal
    };
  }

  // Generate island
  const length = MIN_ISLAND_LENGTH + Math.floor(Math.random() * (MAX_ISLAND_LENGTH - MIN_ISLAND_LENGTH + 1));
  const chestCount = Math.max(1, Math.floor(length / 35));

  let x = base.x;
  let z = base.z;
  let angle = Math.random() * Math.PI * 2;
  const positions = [];

  for (let i = 0; i < length; i++) {
    angle += (Math.random() - 0.5) * 0.5;
    const nextX = x + Math.cos(angle);
    const nextZ = z + Math.sin(angle);
    if (Math.abs(nextX - base.x) > radius - 5 || Math.abs(nextZ - base.z) > radius - 5) {
      angle += Math.PI;
    }
    x += Math.cos(angle);
    z += Math.sin(angle);

    const bx = Math.floor(x);
    const bz = Math.floor(z);
    positions.push({ x: bx, z: bz });

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 1.5) continue;
        dim.getBlock({ x: bx + dx, y: base.y, z: bz + dz })?.setType("minecraft:grass_block");
        dim.getBlock({ x: bx + dx, y: base.y - 1, z: bz + dz })?.setType("minecraft:dirt");
        dim.getBlock({ x: bx + dx, y: base.y - 2, z: bz + dz })?.setType("minecraft:stone");
      }
    }
  }

  // Marker
  dim.getBlock({ x: base.x, y: base.y - 1, z: base.z })?.setType("minecraft:bedrock");

  // Chests + pouches
  const used = new Set();
  let placedChests = 0;

  for (let c = 0; c < chestCount; c++) {
    const idx = Math.floor((c + 0.5) * (positions.length / chestCount));
    const pos = positions[Math.min(idx, positions.length - 1)];
    const key = `${pos.x},${pos.z}`;
    if (used.has(key)) continue;
    used.add(key);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        dim.getBlock({ x: pos.x + dx, y: base.y, z: pos.z + dz })?.setType("minecraft:grass_block");
        dim.getBlock({ x: pos.x + dx, y: base.y - 1, z: pos.z + dz })?.setType("minecraft:dirt");
      }
    }

    const chest = dim.getBlock({ x: pos.x, y: base.y + 1, z: pos.z });
    if (chest) {
      chest.setType("minecraft:chest");
      const cInv = chest.getComponent("inventory")?.container;
      if (cInv) {
        const pouch = new ItemStack("subo:glitch_pouch", 1);
        pouch.setLore([
          "§5Glitch Pouch",
          `§8Rift #${riftId}`,
          "§7Right-click to extract"
        ]);
        cInv.setItem(0, pouch);
        placedChests++;
      }
    }
  }

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }

  return {
    spawn: { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 },
    pouchCount: placedChests
  };
}

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
      to: { x: base.x + radius, y: base.y + 10, z: base.z + radius }
    };
    if (world.tickingAreaManager.hasCapacity(options)) {
      await world.tickingAreaManager.createTickingArea(areaId, options);
      areaCreated = true;
    }
  } catch { }

  for (let y = base.y - 5; y <= base.y + 5; y++) {
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
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }

  freeRiftId(riftId);
}