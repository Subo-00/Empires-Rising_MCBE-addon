import { system, world, ItemStack, MolangVariableMap } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";

const DIMENSION_ID = "subo:rift_realm";
const ISLAND_SPACING = 8000; // blocks between islands
const PLATFORM_RADIUS = 12;

const MAX_ISLAND_LENGTH = 200;   // ← change this to control max length
const MIN_ISLAND_LENGTH = 45;

// ===== REGISTER DIMENSION =====
system.beforeEvents.startup.subscribe((ev) => {
  ev.dimensionRegistry.registerCustomDimension(DIMENSION_ID);
});

// ===== REGISTER ITEM COMPONENT =====
system.beforeEvents.startup.subscribe((ev) => {
  ev.itemComponentRegistry.registerCustomComponent("subo:transporter_use", {
    onUse(event) {
      const player = event.source;
      const item = event.itemStack;
      if (!player || !item) return;

      handleTransporterUse(player, item);
    }
  });
  ev.itemComponentRegistry.registerCustomComponent("subo:glitch_pouch_use", {
    onUse(event) {
      const player = event.source;
      const item = event.itemStack;
      if (!player || !item) return;

      handleGlitchPouchUse(player, item);
    }
  });
});

// ===== GLITCH HANDLER =====
async function handleGlitchPouchUse(player, pouch) {
  // Get which rift this pouch belongs to
  let riftId = null;
  for (const line of pouch.getLore()) {
    const m = line.match(/Rift #(\d+)/);
    if (m) {
      riftId = parseInt(m[1]);
      break;
    }
  }
  if (riftId === null) {
    player.sendMessage("§cThis pouch is corrupted.");
    return;
  }

  // Give placeholder loot
  const loot = new ItemStack("minecraft:netherite_ingot", 1);
  player.getComponent("inventory").container.addItem(loot);

  // Remove the pouch
  const inv = player.getComponent("inventory").container;
  const slot = player.selectedSlotIndex;
  inv.setItem(slot, undefined);

  // Find the matching transporter
  let transporter = null;
  let transporterSlot = -1;

  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it && it.typeId === "subo:rift_transporter") {
      const id = getRiftIdFromLore(it);
      if (id === riftId) {
        transporter = it;
        transporterSlot = i;
        break;
      }
    }
  }

  if (!transporter) {
    player.sendMessage("§eNo matching Rift Transporter found in your inventory.");
    return;
  }

  const data = getPouchDataFromLore(transporter);

  // Debug info (temporary)
  player.sendMessage(`§7Debug → Opened: ${data.opened} / Total: ${data.total}`);

  if (data.total <= 0) {
    player.sendMessage("§cError: This transporter has no pouch count saved. (total = 0)");
    return;
  }

  const newOpened = data.opened + 1;

  // Update transporter lore
  const returnLoc = getReturnLocFromLore(transporter);
  setTransporterLore(transporter, riftId, returnLoc, data.total, newOpened);
  inv.setItem(transporterSlot, transporter);

  player.sendMessage(`§dGlitch Pouch opened (${newOpened}/${data.total})`);

  // === All pouches opened → delete island + send home ===
  if (newOpened >= data.total) {
    player.sendMessage("§5§lAll glitch energy extracted! The island collapses...");

    // Teleport home first
    if (returnLoc) {
      const targetDim = world.getDimension("minecraft:overworld");
      player.teleport(
        { x: returnLoc.x + 0.5, y: returnLoc.y, z: returnLoc.z + 0.5 },
        { dimension: targetDim, checkForBlocks: false }
      );
    }

    await deleteIsland(riftId);
  }
}

async function deleteIsland(riftId) {
  const dim = world.getDimension(DIMENSION_ID);
  const base = getIslandPos(riftId);

  const areaId = `rift_del_${riftId}`;
  try {
    await world.tickingAreaManager.createTickingArea(areaId, {
      dimension: dim,
      from: { x: base.x - 20, y: 50, z: base.z - 20 },
      to: { x: base.x + MAX_ISLAND_LENGTH + 20, y: 80, z: base.z + 20 }
    });
  } catch { }

  // Clear a large area
  for (let x = base.x - 15; x < base.x + MAX_ISLAND_LENGTH + 15; x++) {
    for (let z = base.z - 15; z < base.z + 15; z++) {
      for (let y = 55; y < 75; y++) {
        dim.getBlock({ x, y, z })?.setType("minecraft:air");
      }
    }
  }

  world.tickingAreaManager.removeTickingArea(areaId);
}

// ===== LORE HELPERS =====
function hideData(str) {
  // Make the text completely invisible in the item tooltip
  return "§r§l§o" + str.split("").map(c => "§" + c + "§r").join("");
}

function unhideData(str) {
  // Clean all formatting codes
  return str.replace(/§./g, "");
}

function getRiftIdFromLore(item) {
  const lore = item.getLore();
  for (const line of lore) {
    const match = line.match(/Rift #(\d+)/);
    if (match) return parseInt(match[1]);
  }
  return null;
}

function getReturnLocFromLore(item) {
  const lore = item.getLore();
  for (const line of lore) {
    const match = line.match(/Return: (-?\d+), (-?\d+), (-?\d+)/);
    if (match) {
      return {
        dim: "overworld",
        x: parseInt(match[1]),
        y: parseInt(match[2]),
        z: parseInt(match[3])
      };
    }
  }
  return null;
}

function getPouchDataFromLore(item) {
  const lore = item.getLore();
  let total = 0;
  let opened = 0;
  for (const line of lore) {
    const m1 = line.match(/Pouches: (\d+)\/(\d+)/);
    if (m1) {
      opened = parseInt(m1[1]);
      total = parseInt(m1[2]);
    }
  }
  return { total, opened };
}

function setTransporterLore(item, riftId, returnLoc, pouchTotal = 0, pouchOpened = 0) {
  const lore = [
    "§d✦ Rift Transporter ✦",
    `§bRift #${riftId}`,
    "§7Linked to a personal island",
    "§8Right-click to travel",
    "",
    `§8Return: ${returnLoc.x}, ${returnLoc.y}, ${returnLoc.z}`,
    `§8Pouches: ${pouchOpened}/${pouchTotal}`
  ];
  item.setLore(lore);
}

// ===== NEXT ID (using scoreboard – safe & unlimited for practical purposes) =====
function getNextRiftId() {
  const obj = world.scoreboard.getObjective("rift_counter")
    ?? world.scoreboard.addObjective("rift_counter", "Rift Counter");

  let score = 0;
  try {
    score = obj.getScore("next_id") ?? 0;
  } catch { }
  obj.setScore("next_id", score + 1);
  return score + 1;
}

// ===== ISLAND POSITION =====
function getIslandPos(riftId) {
  const perRow = 50; // 50 islands per row
  const row = Math.floor((riftId - 1) / perRow);
  const col = (riftId - 1) % perRow;

  return {
    x: col * ISLAND_SPACING,
    y: 64,
    z: row * ISLAND_SPACING
  };
}

// ===== GENERATE ISLAND =====
async function ensureIsland(riftId) {
  const dim = world.getDimension(DIMENSION_ID);
  const base = getIslandPos(riftId);

  const areaId = `rift_gen_${riftId}`;
  try {
    await world.tickingAreaManager.createTickingArea(areaId, {
      dimension: dim,
      from: { x: base.x - 30, y: 50, z: base.z - 30 },
      to: { x: base.x + MAX_ISLAND_LENGTH + 30, y: 80, z: base.z + 30 }
    });
  } catch { }

  // Already generated?
  const marker = dim.getBlock({ x: base.x, y: base.y - 1, z: base.z });
  if (marker && marker.typeId === "minecraft:bedrock") {
    world.tickingAreaManager.removeTickingArea(areaId);
    return {
      spawn: { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 },
      pouchCount: 0   // we will preserve the real number from the item lore instead
    };
  }

  // === Generate curved long island ===
  const length = MIN_ISLAND_LENGTH + Math.floor(Math.random() * (MAX_ISLAND_LENGTH - MIN_ISLAND_LENGTH + 1));
  const chestCount = Math.max(1, Math.floor(length / 35)); // longer = more chests

  let x = base.x;
  let z = base.z;
  let angle = Math.random() * Math.PI * 2;
  const positions = [];

  for (let i = 0; i < length; i++) {
    // Curvy movement
    angle += (Math.random() - 0.5) * 0.6;
    x += Math.cos(angle);
    z += Math.sin(angle);

    const bx = Math.floor(x);
    const bz = Math.floor(z);
    positions.push({ x: bx, z: bz });

    // Narrow path (width 3)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 1.5) continue;
        dim.getBlock({ x: bx + dx, y: base.y, z: bz + dz })?.setType("minecraft:grass_block");
        dim.getBlock({ x: bx + dx, y: base.y - 1, z: bz + dz })?.setType("minecraft:dirt");
        dim.getBlock({ x: bx + dx, y: base.y - 2, z: bz + dz })?.setType("minecraft:stone");
      }
    }
  }

  // Place marker
  dim.getBlock({ x: base.x, y: base.y - 1, z: base.z })?.setType("minecraft:bedrock");

  // Place chests with Glitch Pouches
  const usedPositions = new Set();
  let placedChests = 0;
  const maxChests = chestCount;

  for (let i = 0; i < positions.length && placedChests < maxChests; i++) {
    // Spread the chests along the island
    const targetIndex = Math.floor((placedChests + 0.5) * (positions.length / maxChests));
    const pos = positions[Math.min(targetIndex, positions.length - 1)];
    const key = `${pos.x},${pos.z}`;

    if (usedPositions.has(key)) continue;
    usedPositions.add(key);

    // Make sure there is solid ground
    const ground = dim.getBlock({ x: pos.x, y: base.y, z: pos.z });
    if (!ground || ground.typeId === "minecraft:air") continue;

    // Place a small safe platform + chest
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        dim.getBlock({ x: pos.x + dx, y: base.y, z: pos.z + dz })?.setType("minecraft:grass_block");
        dim.getBlock({ x: pos.x + dx, y: base.y - 1, z: pos.z + dz })?.setType("minecraft:dirt");
      }
    }

    const chestBlock = dim.getBlock({ x: pos.x, y: base.y + 1, z: pos.z });
    if (chestBlock) {
      chestBlock.setType("minecraft:chest");

      const inv = chestBlock.getComponent("inventory")?.container;
      if (inv) {
        const pouch = new ItemStack("subo:glitch_pouch", 1);
        pouch.setLore([
          "§5Glitch Pouch",
          `§8Rift #${riftId}`,
          "§7Right-click to extract"
        ]);
        inv.setItem(0, pouch);
        placedChests++;
      }
    }
  }

  // Important: use the REAL number of chests that were placed
  const realPouchCount = placedChests;

  world.tickingAreaManager.removeTickingArea(areaId);

  // Return spawn point + how many pouches this island has
  return {
    spawn: { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 },
    pouchCount: realPouchCount
  };
}

// ===== BEAM EFFECT =====
function playBeam(player) {
  const dim = player.dimension;
  const loc = player.location;

  // Tall column of particles
  for (let y = 0; y < 15; y++) {
    dim.spawnParticle("minecraft:endrod", {
      x: loc.x,
      y: loc.y + y,
      z: loc.z
    });
    dim.spawnParticle("minecraft:portal", {
      x: loc.x,
      y: loc.y + y * 0.7,
      z: loc.z
    });
  }
  // Extra flash
  dim.spawnParticle("minecraft:totem_particle", loc);
}

// ===== MAIN USE HANDLER =====
async function handleTransporterUse(player, item) {
  const currentDim = player.dimension.id;
  let riftId = getRiftIdFromLore(item);
  let returnLoc = getReturnLocFromLore(item);

  // ===== CASE 1: Inside the rift dimension → return home =====
  if (currentDim === DIMENSION_ID) {
    if (!returnLoc) {
      player.sendMessage("§cThis transporter has no return location!");
      return;
    }

    const form = new MessageFormData()
      .title("§dReturn to Reality?")
      .body("Are you sure you want to leave this rift and return?")
      .button1("§aYes, take me back")
      .button2("§cStay here");

    const response = await form.show(player);
    if (response.canceled || response.selection === 1) return;

    playBeam(player);
    await system.waitTicks(15);

    const targetDim = world.getDimension(
      returnLoc.dim === "overworld" ? "minecraft:overworld" : returnLoc.dim
    );

    // 1. First teleport high up (breaks any portal linking the game is doing)
    player.teleport(
      { x: returnLoc.x, y: 300, z: returnLoc.z },
      { dimension: targetDim, checkForBlocks: false, keepVelocity: false }
    );

    await system.waitTicks(5);

    // 2. Then teleport to the real location
    player.teleport(
      { x: returnLoc.x + 0.5, y: returnLoc.y, z: returnLoc.z + 0.5 },
      { dimension: targetDim, checkForBlocks: false, keepVelocity: false }
    );

    player.sendMessage("§aYou have returned from the rift.");
    return;
  }

  // ===== CASE 2: In overworld (or other) → go to rift =====
  // Create new ID if this is a fresh transporter
  if (riftId === null) {
    riftId = getNextRiftId();
    returnLoc = {
      dim: "overworld",
      x: Math.floor(player.location.x),
      y: Math.floor(player.location.y),
      z: Math.floor(player.location.z)
    };
    const islandData = await ensureIsland(riftId);

    setTransporterLore(item, riftId, returnLoc, islandData.pouchCount, 0);

    // Give the updated item back (important!)
    const inv = player.getComponent("inventory").container;
    const slot = player.selectedSlotIndex;
    inv.setItem(slot, item);
  }

  const form = new MessageFormData()
    .title("§5Open Rift?")
    .body(`This transporter is linked to Rift #${riftId}.\n\nAre you sure you want to enter?`)
    .button1("§aEnter the Rift")
    .button2("§cCancel");

  const response = await form.show(player);
  if (response.canceled || response.selection === 1) return;

  // Update return location
  returnLoc = {
    dim: "overworld",
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z)
  };

  const islandData = await ensureIsland(riftId);

  // Keep the original pouch count if we already had one
  const existingData = getPouchDataFromLore(item);
  const totalPouches = existingData.total > 0 ? existingData.total : islandData.pouchCount;

  setTransporterLore(item, riftId, returnLoc, totalPouches, existingData.opened);
  const inv = player.getComponent("inventory").container;
  inv.setItem(player.selectedSlotIndex, item);

  playBeam(player);
  await system.waitTicks(25);

  const riftDim = world.getDimension(DIMENSION_ID);
  player.teleport(islandData.spawn, { dimension: riftDim });
  player.sendMessage(`§dYou have entered Rift #${riftId}.`);
}