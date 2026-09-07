import { system, world, ItemStack, MolangVariableMap } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import { forceNearbyTroopsStay, restoreNearbyTroops } from "../sharedHelpers/troopTeleport.js";

const DIMENSION_ID = "subo:rift_realm";
const ISLAND_SPACING = 8000; // blocks between islands
const PLATFORM_RADIUS = 12;

const MAX_ISLAND_LENGTH = 150;
const MIN_ISLAND_LENGTH = 100;

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

// ===== HELPERS =====
async function returnPlayerHome(player, returnLoc) {
  // Leave troops behind in the rift
  forceNearbyTroopsStay(player);

  // Give the stay event time to apply
  await system.waitTicks(5);

  try {
    player.runCommand("fog @s remove rift_fog");
  } catch { }

  if (!returnLoc) {
    player.sendMessage("§cNo return location saved!");
    return;
  }

  const targetDim = world.getDimension(
    returnLoc.dim === "overworld" ? "minecraft:overworld" : returnLoc.dim
  );

  const finalLoc = {
    x: returnLoc.x + 0.5,
    y: returnLoc.y,
    z: returnLoc.z + 0.5
  };

  // High up first
  player.teleport(
    { x: returnLoc.x, y: 300, z: returnLoc.z },
    { dimension: targetDim, checkForBlocks: false, keepVelocity: false }
  );

  await system.waitTicks(5);

  player.teleport(finalLoc, {
    dimension: targetDim,
    checkForBlocks: false,
    keepVelocity: false
  });

  // Resume any troops that were left here earlier
  restoreNearbyTroops(player);

  player.sendMessage("§aYou have returned from the rift.");
}

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

    // Reset the pouch counter so the transporter is clean again
    const fogId = getFogFromLore(transporter);
    setTransporterLore(transporter, riftId, returnLoc, data.total, 0, fogId);
    inv.setItem(transporterSlot, transporter);

    await returnPlayerHome(player, returnLoc);
    await deleteIsland(riftId);
  }
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
      to:   { x: base.x + radius, y: base.y + 10, z: base.z + radius }
    };

    if (world.tickingAreaManager.hasCapacity(options)) {
      await world.tickingAreaManager.createTickingArea(areaId, options);
      areaCreated = true;
    }
  } catch { }

  // Correct height range – islands live around y = 180
  for (let y = base.y - 5; y <= base.y + 5; y++) {
    for (let x = base.x - radius; x <= base.x + radius; x++) {
      for (let z = base.z - radius; z <= base.z + radius; z++) {
        const b = dim.getBlock({ x, y, z });
        if (b && b.typeId !== "minecraft:air") {
          b.setType("minecraft:air");
        }
      }
    }
    await system.waitTicks(1); // yield so we don’t freeze the server
  }

  // Always clear the bedrock marker
  dim.getBlock({ x: base.x, y: base.y - 1, z: base.z })?.setType("minecraft:air");

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }

  // Make this ID available again
  freeRiftId(riftId);
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

function setTransporterLore(item, riftId, returnLoc, pouchTotal = 0, pouchOpened = 0, fogId = "minecraft:fog_the_end") {
  const lore = [
    "§d✦ Rift Transporter ✦",
    `§bRift #${riftId}`,
    "§7Linked to a personal island",
    "§8Right-click to travel",
    "",
    `§8Return: ${returnLoc.x}, ${returnLoc.y}, ${returnLoc.z}`,
    `§8Pouches: ${pouchOpened}/${pouchTotal}`,
    `§8Fog: ${fogId}`
  ];
  item.setLore(lore);
}

function getFogFromLore(item) {
  const lore = item.getLore();
  for (const line of lore) {
    const m = line.match(/Fog: (minecraft:fog_\w+)/);
    if (m) return m[1];
  }
  return "minecraft:fog_hell"; // fallback
}

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
    free.sort((a, b) => a - b); // keep lowest IDs first
    saveFreeRiftIds(free);
  }
}

// ===== NEXT ID (using scoreboard – safe & unlimited for practical purposes) =====
function getNextRiftId() {
  // Prefer a previously freed ID
  const free = getFreeRiftIds();
  if (free.length > 0) {
    const id = free.shift();
    saveFreeRiftIds(free);
    return id;
  }

  // Otherwise allocate a new one
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
  // Map sequential IDs to a square spiral centered at 0,0
  // 1 → (0,0), 2 → (1,0), 3 → (1,1), 4 → (0,1), 5 → (-1,1), …
  let x = 0, z = 0;
  if (riftId > 1) {
    const layer = Math.ceil((Math.sqrt(riftId) - 1) / 2);
    const leg = riftId - (2 * layer - 1) ** 2;
    const side = Math.floor(leg / (layer * 2));
    const offset = leg % (layer * 2);

    if (side === 0) { x = layer;          z = -layer + offset; }
    else if (side === 1) { x = layer - offset; z = layer; }
    else if (side === 2) { x = -layer;         z = layer - offset; }
    else { x = -layer + offset; z = -layer; }
  }

  return {
    x: x * ISLAND_SPACING,
    y: 180,
    z: z * ISLAND_SPACING
  };
}

// ===== GENERATE ISLAND =====
async function ensureIsland(riftId) {
  const dim = world.getDimension(DIMENSION_ID);
  const base = getIslandPos(riftId);

  // Safe size – stays well under script ticking-area limits
  const radius = 80;                       // ~10 chunks across
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
    } else {
      console.warn(`[Rift] No capacity for ticking area ${areaId}`);
    }
  } catch (e) {
    console.warn(`[Rift] Failed to create ticking area: ${e}`);
  }

  // Already generated?
  const marker = dim.getBlock({ x: base.x, y: base.y - 1, z: base.z });
  if (marker && marker.typeId === "minecraft:bedrock") {
    if (areaCreated) {
      try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
    }
    return {
      spawn: { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 },
      pouchCount: 0
    };
  }

  // === Generate a constrained curved island ===
  const length = MIN_ISLAND_LENGTH + Math.floor(Math.random() * (MAX_ISLAND_LENGTH - MIN_ISLAND_LENGTH + 1));
  const chestCount = Math.max(1, Math.floor(length / 35));

  let x = base.x;
  let z = base.z;
  let angle = Math.random() * Math.PI * 2;
  const positions = [];
  let placedBlocks = 0;

  for (let i = 0; i < length; i++) {
    angle += (Math.random() - 0.5) * 0.5;

    // Keep the path inside the safe radius
    const nextX = x + Math.cos(angle);
    const nextZ = z + Math.sin(angle);
    if (Math.abs(nextX - base.x) > radius - 5 || Math.abs(nextZ - base.z) > radius - 5) {
      angle += Math.PI; // bounce back
    }

    x += Math.cos(angle);
    z += Math.sin(angle);

    const bx = Math.floor(x);
    const bz = Math.floor(z);
    positions.push({ x: bx, z: bz });

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 1.5) continue;

        const b1 = dim.getBlock({ x: bx + dx, y: base.y, z: bz + dz });
        const b2 = dim.getBlock({ x: bx + dx, y: base.y - 1, z: bz + dz });
        const b3 = dim.getBlock({ x: bx + dx, y: base.y - 2, z: bz + dz });

        if (b1) { b1.setType("minecraft:grass_block"); placedBlocks++; }
        if (b2) b2.setType("minecraft:dirt");
        if (b3) b3.setType("minecraft:stone");
      }
    }
  }

  // Marker
  dim.getBlock({ x: base.x, y: base.y - 1, z: base.z })?.setType("minecraft:bedrock");

  // Chests
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
      const inv = chest.getComponent("inventory")?.container;
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

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }

  // Debug so you can see what happened
  console.warn(`[Rift] Island ${riftId} → blocks: ${placedBlocks}, chests: ${placedChests}, areaCreated: ${areaCreated}`);

  return {
    spawn: { x: base.x + 0.5, y: base.y + 1, z: base.z + 0.5 },
    pouchCount: placedChests
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
    await returnPlayerHome(player, returnLoc);
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

    // Pick a random fog for this island
    const fogOptions = [
      "minecraft:fog_hell",
      "minecraft:fog_soulsand_valley",
      "minecraft:fog_basalt_deltas"
    ];
    const chosenFog = fogOptions[Math.floor(Math.random() * fogOptions.length)];

    const islandData = await ensureIsland(riftId);

    setTransporterLore(item, riftId, returnLoc, islandData.pouchCount, 0, chosenFog);

    const inv = player.getComponent("inventory").container;
    inv.setItem(player.selectedSlotIndex, item);
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

  const existingFog = getFogFromLore(item);
  setTransporterLore(item, riftId, returnLoc, totalPouches, existingData.opened, existingFog);
  const inv = player.getComponent("inventory").container;
  inv.setItem(player.selectedSlotIndex, item);

  playBeam(player);
  await system.waitTicks(25);

  // Leave troops behind in the overworld
  forceNearbyTroopsStay(player);

  // Give the stay event time to actually apply
  await system.waitTicks(5);

  const riftDim = world.getDimension(DIMENSION_ID);
  const spawn = islandData.spawn;

  player.teleport(spawn, { dimension: riftDim });

  player.sendMessage(`§dYou have entered Rift #${riftId}.`);

  // Dark fog …
  const fogId = getFogFromLore(item);
  try {
    player.runCommand("fog @s remove rift_fog");
    player.runCommand(`fog @s push ${fogId} rift_fog`);
  } catch { }
}