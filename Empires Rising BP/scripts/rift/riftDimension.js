import { system, world, ItemStack } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { getStorageLocation, setTag, getTag } from "../spawner/spawnerHelpers.js";
import { forceNearbyTroopsStay, restoreNearbyTroops } from "../sharedHelpers/troopTeleport.js";

import {
  DIMENSION_ID, RIFT_BLOCK, RIFT_ENTITY,
  ISLAND_SPACING, MAX_ISLAND_LENGTH, MIN_ISLAND_LENGTH,
  LAPIS_ID, SECONDS_PER_LAPIS, MAX_OPEN_SECONDS, TICKS_PER_SECOND,
  WARNING_15, WARNING_5
} from "../config/riftConfig.js";

import {
  trySetState, getNum, setNum, ensureId, getRiftEntityAt,
  isActive, isBroken, clearRiftState, blockLoc,
  clearPlayerRiftTags, setPlayerRiftTags, getPlayerRiftReturn,
  countItem, removeItemAmount
} from "./riftHelpers.js";


// riftId → { timeoutId, x, y, z }
const activeRifts = new Map();

// playerId → tick until which they cannot be teleported again
const teleportLock = new Map();
// =============================================================================
// REGISTER DIMENSION + COMPONENTS
// =============================================================================
system.beforeEvents.startup.subscribe((ev) => {
  ev.dimensionRegistry.registerCustomDimension(DIMENSION_ID);
});

system.beforeEvents.startup.subscribe((ev) => {
  ev.itemComponentRegistry.registerCustomComponent("subo:glitch_pouch_use", {
    onUse(event) {
      const player = event.source;
      const item = event.itemStack;
      if (!player || !item) return;
      handleGlitchPouchUse(player, item);
    }
  });
});

// =============================================================================
// PLACEMENT → spawn persistence entity
// =============================================================================
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  if (ev.block?.typeId !== RIFT_BLOCK) return;

  const dim = ev.block.dimension;
  const block = ev.block;

  system.run(() => {
    if (!getRiftEntityAt(dim, block.location)) {
      const ent = dim.spawnEntity(RIFT_ENTITY, getStorageLocation(block));
      setTag(ent, "bx:", block.location.x);
      setTag(ent, "by:", block.location.y);
      setTag(ent, "bz:", block.location.z);
      trySetState(block, "inactive");
    }
  });
});

// =============================================================================
// INTERACTION → activation form
// =============================================================================
const formOpenPlayers = new Set();

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (ev.block?.typeId !== RIFT_BLOCK) return;
  if (ev.player.isSneaking) return;

  ev.cancel = true;
  if (formOpenPlayers.has(ev.player.id)) return;
  formOpenPlayers.add(ev.player.id);

  const blockLoc = { ...ev.block.location };
  const dimId = ev.block.dimension.id;

  system.run(() => {
    openRiftForm(ev.player, blockLoc, dimId);
    system.runTimeout(() => formOpenPlayers.delete(ev.player.id), 10);
  });
});

function openRiftForm(player, loc, dimId) {
  const dim = world.getDimension(dimId);
  const block = dim.getBlock(loc);
  if (!block || block.typeId !== RIFT_BLOCK) return;

  // Hard early-out for broken state (entity may already be gone)
  let entity = getRiftEntityAt(dim, loc);
  if (isBroken(entity) || (block.permutation.getState("subo:state") === "broken")) {
    player.onScreenDisplay.setActionBar("§cThis transporter is broken.");
    return;
  }

  // Only create the entity if it truly does not exist AND the pad is not broken
  if (!entity) {
    entity = dim.spawnEntity(RIFT_ENTITY, getStorageLocation(block));
    setTag(entity, "bx:", loc.x);
    setTag(entity, "by:", loc.y);
    setTag(entity, "bz:", loc.z);
  }

  const riftIdForUi = getNum(entity, "riftId:", 0);
  const info = activeRifts.get(riftIdForUi);
  if (info || isActive(entity)) {
    const remaining = info
      ? Math.max(0, info.endTick - system.currentTick)
      : getNum(entity, "remaining:", 0);
    const secs = Math.ceil(remaining / TICKS_PER_SECOND);
    player.onScreenDisplay.setActionBar(`§dRift open – §f${secs}s §dremaining`);
    return;
  }

  const lapisCount = countItem(player, LAPIS_ID);
  if (lapisCount === 0) {
    player.onScreenDisplay.setActionBar("§cYou need Lapis Lazuli to open a rift.");
    return;
  }

  const maxSeconds = Math.min(MAX_OPEN_SECONDS, lapisCount * SECONDS_PER_LAPIS);

  const form = new ModalFormData()
    .title("§5✦ Open Rift Transporter ✦")
    .slider(`§7Duration (seconds)  §8(1 Lapis = ${SECONDS_PER_LAPIS}s)`, 10, maxSeconds, {
      valueStep: 10,
      defaultValue: 10
    });

  form.show(player).then((res) => {
    if (res.canceled) return;
    const seconds = Math.floor(res.formValues[0] ?? 0);
    if (seconds < 10) return;

    const needed = Math.ceil(seconds / SECONDS_PER_LAPIS);
    const removed = removeItemAmount(player, LAPIS_ID, needed);
    if (removed < needed) {
      player.onScreenDisplay.setActionBar("§cNot enough Lapis.");
      return;
    }

    activateRift(dim, block, entity, seconds * TICKS_PER_SECOND);
    player.playSound("random.pop");
    player.onScreenDisplay.setActionBar(`§aRift opened for §f${seconds}s`);
  });
}

async function activateRift(dim, block, entity, totalTicks) {
  let riftId = getNum(entity, "riftId:", 0);
  if (!riftId) {
    riftId = getNextRiftId();
    setNum(entity, "riftId:", riftId);
  }

  setTag(entity, "returnX:", block.location.x);
  setTag(entity, "returnY:", block.location.y);
  setTag(entity, "returnZ:", block.location.z);

  const fogOptions = [
    "minecraft:fog_hell",
    "minecraft:fog_soulsand_valley",
    "minecraft:fog_basalt_deltas"
  ];
  setTag(entity, "fog:", fogOptions[Math.floor(Math.random() * fogOptions.length)]);

  const islandData = await ensureIsland(riftId);

  // only set pouchTotal when the island was just generated
  if (islandData.pouchCount > 0) {
    setNum(entity, "pouchTotal:", islandData.pouchCount);
  }
  setNum(entity, "total:", totalTicks);
  setNum(entity, "remaining:", totalTicks);   // only for the action-bar display

  // one-shot timer – survives chunk unload
  const timeoutId = system.runTimeout(() => {
    activeRifts.delete(riftId);
    const d = world.getDimension("minecraft:overworld");
    let ent = null;
    try { ent = getRiftEntityAt(d, block.location); } catch { }
    forceCloseRift(d, ent, false, riftId, { ...block.location });
  }, totalTicks);

  // 15s warning (only if the duration is long enough)
  if (totalTicks > WARNING_15) {
    system.runTimeout(() => {
      if (!activeRifts.has(riftId)) return;   // already closed early
      for (const p of world.getPlayers()) {
        const data = getPlayerRiftReturn(p);
        if (data && data.riftId === riftId && p.dimension.id === DIMENSION_ID) {
          p.onScreenDisplay.setActionBar("§eRift closing in 15 seconds!");
        }
      }
    }, totalTicks - WARNING_15);
  }

  activeRifts.set(riftId, {
    timeoutId,
    x: block.location.x,
    y: block.location.y,
    z: block.location.z,
    endTick: system.currentTick + totalTicks
  });

  trySetState(block, "active");
  startStepOnTicker();          // only for step-on detection
  dim.playSound("portal.trigger", block.location);
}

// =============================================================================
// STEP-ON DETECTION
// =============================================================================
let stepRunId = null;

function startStepOnTicker() {
  if (stepRunId !== null) return;
  stepRunId = system.runInterval(() => {
    if (activeRifts.size === 0) {
      stopStepOnTicker();
      return;
    }

    const dim = world.getDimension("minecraft:overworld");
    const now = system.currentTick;

    for (const [riftId, info] of [...activeRifts]) {
      // ---- remaining time & particles ----
      const remaining = info.endTick - now;
      if (remaining <= 0) {
        // safety – the one-shot should already have fired
        activeRifts.delete(riftId);
        continue;
      }

      // tiny upward particles
      try {
        dim.spawnParticle(
          "subo:rift_transporter",
          { x: info.x + 0.5, y: info.y + 0.1, z: info.z + 0.5 }
        );
      } catch (e) {
        console.warn(e);
      }

      // live remaining on the entity (for action-bar)
      let entity = null;
      try { entity = getRiftEntityAt(dim, { x: info.x, y: info.y, z: info.z }); } catch { }
      if (entity && entity.isValid) {
        setNum(entity, "remaining:", remaining);
      }

      // 5-second warning
      if (remaining === WARNING_5) {
        for (const p of world.getPlayers()) {
          const data = getPlayerRiftReturn(p);
          if (data && data.riftId === riftId && p.dimension.id === DIMENSION_ID) {
            p.onScreenDisplay.setActionBar("§cRift closing in 5 seconds!");
          }
        }
      }

      // ---- step-on teleport ----
      if (isBroken(entity)) continue;          // never teleport on a broken pad

      const players = dim.getPlayers({
        location: { x: info.x + 0.5, y: info.y + 0.5, z: info.z + 0.5 },
        maxDistance: 0.1
      });

      for (const player of players) {
        const py = Math.floor(player.location.y);
        if (py < info.y || py > info.y + 1) continue;
        if (player.dimension.id === DIMENSION_ID) continue;

        const lockedUntil = teleportLock.get(player.id) ?? 0;
        if (now < lockedUntil) continue;

        if (getPlayerRiftReturn(player)) clearPlayerRiftTags(player);

        // prune expired locks
        for (const [id, until] of teleportLock) {
          if (now >= until) teleportLock.delete(id);
        }

        teleportLock.set(player.id, now + 40);

        teleportPlayerToRift(
          player,
          entity,
          { x: info.x, y: info.y, z: info.z },
          riftId
        );
      }
    }
  }, 5);
}

function stopStepOnTicker() {
  if (stepRunId === null) return;
  system.clearRun(stepRunId);
  stepRunId = null;
}

async function teleportPlayerToRift(player, entity, loc, forcedRiftId = null) {
  const riftId = forcedRiftId ?? (entity ? getNum(entity, "riftId:", 0) : 0);
  if (!riftId) {
    console.warn("[DBG] teleport aborted – no riftId");
    return;
  }

  if (entity && isBroken(entity)) {
    console.warn("[DBG] teleport aborted – transporter broken");
    return;
  }

  if (player.dimension.id === DIMENSION_ID) {
    console.warn("[DBG] already inside rift dimension – abort");
    return;
  }

  // still respect broken state when we can read the entity
  if (entity && isBroken(entity)) {
    console.warn("[DBG] teleport aborted – transporter broken");
    return;
  }

  console.warn(`[DBG] START teleport to rift #${riftId}`);

  const islandData = await ensureIsland(riftId);

  setPlayerRiftTags(player, riftId, loc);

  forceNearbyTroopsStay(player);
  await system.waitTicks(5);

  const riftDim = world.getDimension(DIMENSION_ID);
  player.teleport(islandData.spawn, { dimension: riftDim, checkForBlocks: false });

  const fog = entity
    ? getTag(entity, "fog:", "minecraft:fog_hell")
    : "minecraft:fog_hell";
  try {
    player.runCommand("fog @s remove rift_fog");
    player.runCommand(`fog @s push ${fog} rift_fog`);
  } catch { }

  player.sendMessage(`§dYou have entered Rift #${riftId}.`);
}

// =============================================================================
// FORCE CLOSE / RETURN ALL PLAYERS
// =============================================================================
async function forceCloseRift(dim, entity, wasDestroyed, forcedRiftId = null, forcedLoc = null) {
  const riftId = forcedRiftId
    ?? (entity ? getNum(entity, "riftId:", 0) : 0);

  console.warn(`[DBG forceClose] START  riftId=${riftId}  wasDestroyed=${wasDestroyed}  entityValid=${!!(entity && entity.isValid)}`);

  if (!riftId) {
    console.warn("[DBG forceClose] ABORT – no riftId");
    return;
  }

  // cancel the one-shot timer if it is still pending
  const info = activeRifts.get(riftId);
  if (info) {
    try { system.clearRun(info.timeoutId); } catch { }
    activeRifts.delete(riftId);
  }

  const loc = forcedLoc
    ?? (entity
      ? (blockLoc(entity) ?? {
        x: getNum(entity, "returnX:", 0),
        y: getNum(entity, "returnY:", 0),
        z: getNum(entity, "returnZ:", 0)
      })
      : null);

  // temporary load of the pad only
  const areaId = `rift_close_${riftId}_${Date.now()}`;
  let areaCreated = false;
  if (loc) {
    try {
      const options = {
        dimension: dim,
        from: { x: loc.x - 2, y: loc.y - 2, z: loc.z - 2 },
        to: { x: loc.x + 2, y: loc.y + 2, z: loc.z + 2 }
      };
      if (world.tickingAreaManager.hasCapacity(options)) {
        await world.tickingAreaManager.createTickingArea(areaId, options);
        areaCreated = true;
        await system.waitTicks(5);
      }
    } catch { }
  }

  if (entity && entity.isValid) {
    setNum(entity, "remaining:", 0);
  }

  if (loc) {
    try {
      const block = dim.getBlock(loc);
      if (block?.typeId === RIFT_BLOCK) {
        trySetState(block, wasDestroyed ? "broken" : "inactive");
      }
    } catch { }
  }

  const playersToReturn = [];
  for (const p of world.getPlayers()) {
    const data = getPlayerRiftReturn(p);
    const match = data && data.riftId === riftId && p.dimension.id === DIMENSION_ID;
    console.warn(`[DBG forceClose] check ${p.name}: data=${data ? data.riftId : "null"} dim=${p.dimension.id} → ${match ? "RETURN" : "skip"}`);
    if (match) playersToReturn.push(p);
  }

  for (const p of playersToReturn) {
    console.warn(`[DBG] returning ${p.name} home from rift #${riftId}`);
    await returnPlayerHome(p, {
      dim: "overworld",
      x: loc.x,
      y: loc.y,
      z: loc.z
    });
    clearPlayerRiftTags(p);
  }

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }

  if (wasDestroyed) {
    if (riftId) {
      await deleteIsland(riftId);
    }
    if (entity && entity.isValid) {
      clearRiftState(entity);
      entity.remove();
    }
  }

  console.warn(`[DBG forceClose] FINISHED for rift #${riftId}`);
}

// =============================================================================
// BREAK HANDLER
// =============================================================================
export function handleRiftTransporterBreak(dim, loc) {
  const entity = getRiftEntityAt(dim, loc);
  if (!entity) return;

  system.run(async () => {
    await forceCloseRift(dim, entity, true);
  });
}

// =============================================================================
// GLITCH POUCH
// =============================================================================
async function handleGlitchPouchUse(player, pouch) {
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

  // Always give loot + consume the pouch
  const loot = new ItemStack("minecraft:netherite_ingot", 1);
  player.getComponent("inventory")?.container.addItem(loot);

  const inv = player.getComponent("inventory")?.container;
  if (inv) inv.setItem(player.selectedSlotIndex, undefined);

  const returnData = getPlayerRiftReturn(player);
  const insideCorrectRift =
    returnData &&
    returnData.riftId === riftId &&
    player.dimension.id === DIMENSION_ID;

  // Resolve pad location (from player tags if inside, otherwise from activeRifts / entity scan)
  let loc = null;
  if (returnData && returnData.riftId === riftId) {
    loc = { x: returnData.x, y: returnData.y, z: returnData.z };
  } else {
    const info = activeRifts.get(riftId);
    if (info) loc = { x: info.x, y: info.y, z: info.z };
  }

  const dim = world.getDimension("minecraft:overworld");

  // Temporary load of the pad so we can update the entity / block
  const areaId = `rift_pouch_${riftId}_${Date.now()}`;
  let areaCreated = false;
  if (loc) {
    try {
      const options = {
        dimension: dim,
        from: { x: loc.x - 2, y: loc.y - 2, z: loc.z - 2 },
        to: { x: loc.x + 2, y: loc.y + 2, z: loc.z + 2 }
      };
      if (world.tickingAreaManager.hasCapacity(options)) {
        await world.tickingAreaManager.createTickingArea(areaId, options);
        areaCreated = true;
        await system.waitTicks(5);
      }
    } catch { }
  }

  let entity = loc ? getRiftEntityAt(dim, loc) : null;

  // Fallback: if we still don't have a loc/entity, try any entity with this riftId
  if (!entity) {
    try {
      for (const e of dim.getEntities({ type: RIFT_ENTITY })) {
        if (getNum(e, "riftId:", 0) === riftId) {
          entity = e;
          loc = blockLoc(e) ?? loc;
          break;
        }
      }
    } catch { }
  }

  let total = 0;
  let opened = 0;

  if (entity) {
    total = getNum(entity, "pouchTotal:", 0);
    opened = getNum(entity, "pouchOpened:", 0) + 1;
    setNum(entity, "pouchOpened:", opened);
  }

  player.sendMessage(`§dGlitch Pouch opened (${opened}/${total || "?"})`);

  // If the player is inside this rift → return everyone + deactivate
  if (insideCorrectRift) {
    await forceCloseRift(dim, entity, false, riftId, loc);
  } else {
    // Outside: only cancel the timer / mark inactive if the rift is still open
    const info = activeRifts.get(riftId);
    if (info) {
      try { system.clearRun(info.timeoutId); } catch { }
      activeRifts.delete(riftId);
    }
    if (entity && entity.isValid) {
      setNum(entity, "remaining:", 0);
    }
    if (loc) {
      try {
        const block = dim.getBlock(loc);
        if (block?.typeId === RIFT_BLOCK) trySetState(block, "inactive");
      } catch { }
    }
  }

  // Last pouch → permanent break + delete island (no player teleport beyond what forceClose already did)
  if (opened >= total && total > 0) {
    player.sendMessage("§5§lAll glitch energy extracted! The island collapses...");
    await deleteIsland(riftId);
    freeRiftId(riftId);

    if (entity && entity.isValid) {
      setTag(entity, "broken:", "1");
      if (loc) {
        try {
          const block = dim.getBlock(loc);
          if (block?.typeId === RIFT_BLOCK) trySetState(block, "broken");
        } catch { }
      }
      clearRiftState(entity);
      entity.remove();
    }
  }

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }
}

// =============================================================================
// RETURN PLAYER HOME (kept from original, slightly cleaned)
// =============================================================================
async function returnPlayerHome(player, returnLoc) {
  console.warn(`[DBG returnPlayerHome] start for ${player.name}`);

  forceNearbyTroopsStay(player);
  await system.waitTicks(5);

  try {
    player.runCommand("fog @s remove rift_fog");
  } catch { }

  if (!returnLoc) {
    console.warn("[DBG returnPlayerHome] no returnLoc!");
    player.sendMessage("§cNo return location saved!");
    return;
  }

  const targetDim = world.getDimension(
    returnLoc.dim === "overworld" ? "minecraft:overworld" : returnLoc.dim
  );

  const finalLoc = {
    x: returnLoc.x + 0.5,
    y: returnLoc.y + 1,
    z: returnLoc.z + 0.5
  };

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

  restoreNearbyTroops(player);
  player.sendMessage("§aYou have returned from the rift.");
  console.warn(`[DBG returnPlayerHome] finished for ${player.name}`);
}

// =============================================================================
// ISLAND MANAGEMENT (kept & cleaned from original)
// =============================================================================
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