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

// -----------------------------------------------------------------------------
// REGISTER Dimension and Pouch Usage
// -----------------------------------------------------------------------------

export function registerRiftComponents() {
  system.beforeEvents.startup.subscribe((ev) => {
    // Custom dimension
    ev.dimensionRegistry.registerCustomDimension(DIMENSION_ID);

    // Glitch pouch item component
    ev.itemComponentRegistry.registerCustomComponent("subo:glitch_pouch_use", {
      onUse(event) {
        const player = event.source;
        const item = event.itemStack;
        if (!player || !item) return;
        handleGlitchPouchUse(player, item);
      }
    });
  });
}

// -----------------------------------------------------------------------------
// RECOVERY (server restart / chunk reload)
// -----------------------------------------------------------------------------
const recoveredRifts = new Set();   // prevent double-recovery of the same riftId

function recoverSingleRift(entity) {
  if (!entity || !entity.isValid) return;

  const riftId = getNum(entity, "riftId:", 0);
  if (!riftId || recoveredRifts.has(riftId)) return;
  recoveredRifts.add(riftId);

  const loc = blockLoc(entity);
  if (!loc) return;

  const dim = world.getDimension("minecraft:overworld");
  let block = null;
  try { block = dim.getBlock(loc); } catch { }

  // ---- permanently broken ----
  if (isBroken(entity)) {
    // convert old broken pads to the new destroyed block
    if (block?.typeId === RIFT_BLOCK) {
      try {
        block.setType("subo:destroyed_rift");
      } catch { }
    }
    clearRiftState(entity);
    entity.remove();
    return;
  }

  const remaining = getNum(entity, "remaining:", 0);

  // ---- still had time left → RESUME ----
  if (remaining > 0) {
    // cancel any leftover timer just in case
    const old = activeRifts.get(riftId);
    if (old) {
      try { system.clearRun(old.timeoutId); } catch { }
      activeRifts.delete(riftId);
    }

    const timeoutId = system.runTimeout(() => {
      activeRifts.delete(riftId);
      let ent = null;
      try { ent = getRiftEntityAt(dim, loc); } catch { }
      forceCloseRift(dim, ent, false, riftId, { ...loc });
    }, remaining);

    // re-schedule 15 s warning if still relevant
    if (remaining > WARNING_15) {
      system.runTimeout(() => {
        if (!activeRifts.has(riftId)) return;
        for (const p of world.getPlayers()) {
          const data = getPlayerRiftReturn(p);
          if (data && data.riftId === riftId && p.dimension.id === DIMENSION_ID) {
            p.onScreenDisplay.setActionBar("§eRift closing in 15 seconds!");
          }
        }
      }, remaining - WARNING_15);
    }

    activeRifts.set(riftId, {
      timeoutId,
      x: loc.x,
      y: loc.y,
      z: loc.z,
      endTick: system.currentTick + remaining
    });

    if (block?.typeId === RIFT_BLOCK) trySetState(block, "active");
    startStepOnTicker();
    console.warn(`[Rift] Resumed rift #${riftId} with ${Math.ceil(remaining / TICKS_PER_SECOND)}s left`);
    return;
  }

  // ---- remaining == 0 but block still says "active" → clean close ----
  if (block?.permutation?.getState("subo:state") === "active") {
    forceCloseRift(dim, entity, false, riftId, { ...loc });
  }
}

function recoverStuckPlayers() {
  for (const p of world.getPlayers()) {
    if (p.dimension.id !== DIMENSION_ID) continue;

    const data = getPlayerRiftReturn(p);
    if (!data) {
      // no return tag → emergency eject to overworld spawn
      p.teleport({ x: 0, y: 100, z: 0 }, { dimension: world.getDimension("minecraft:overworld") });
      p.sendMessage("§cYou were stuck in a rift. Returned to spawn.");
      continue;
    }

    // if the corresponding rift is no longer active, bring them home
    if (!activeRifts.has(data.riftId)) {
      returnPlayerHome(p, {
        dim: "overworld",
        x: data.x,
        y: data.y,
        z: data.z
      });
      clearPlayerRiftTags(p);
    }
  }
}

function recoverAllRifts() {
  recoveredRifts.clear();
  const dim = world.getDimension("minecraft:overworld");
  try {
    for (const e of dim.getEntities({ type: RIFT_ENTITY })) {
      recoverSingleRift(e);
    }
  } catch (err) {
    console.warn("[Rift] recovery scan failed", err);
  }
  recoverStuckPlayers();
}

// =============================================================================
// REGISTER DIMENSION + COMPONENTS
// =============================================================================

// Run recovery a few seconds after the world is fully loaded
system.runTimeout(() => {
  recoverAllRifts();
}, 60);   // 3 seconds – safe for most servers

world.afterEvents.entityLoad.subscribe((ev) => {
  if (ev.entity?.typeId !== RIFT_ENTITY) return;
  // small delay so tags are readable
  system.runTimeout(() => recoverSingleRift(ev.entity), 5);
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

export function openRiftForm(player, loc, dimId) {
  const dim = world.getDimension(dimId);
  const block = dim.getBlock(loc);
  if (!block || block.typeId !== RIFT_BLOCK) return;

  // Hard early-out for broken state (entity may already be gone)
  let entity = getRiftEntityAt(dim, loc);
  if (isBroken(entity) || (block.permutation.getState("subo:state") === "broken")) {
    player.onScreenDisplay.setActionBar("§cThis port is broken.");
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
    .title("§5✦ Open Rift Port ✦")
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
    player.onScreenDisplay.setActionBar(`§dRift opened for §f${seconds}s`);
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
      const remaining = info.endTick - now;

      // Safety – timer should already have fired
      if (remaining <= 0) {
        activeRifts.delete(riftId);
        continue;
      }

      // ---- only touch the overworld if the pad chunk is still loaded ----
      let entity = null;
      let chunkLoaded = false;
      try {
        // getBlock throws LocationInUnloadedChunkError when the chunk is gone
        const testBlock = dim.getBlock({ x: info.x, y: info.y, z: info.z });
        chunkLoaded = !!testBlock;
        if (chunkLoaded) {
          entity = getRiftEntityAt(dim, { x: info.x, y: info.y, z: info.z });
        }
      } catch {
        chunkLoaded = false;
      }

      // Entity gone or marked broken → drop from active list
      if (chunkLoaded && (!entity || isBroken(entity))) {
        activeRifts.delete(riftId);
        continue;
      }

      // Particles only when the chunk is loaded (avoids the warning spam)
      if (chunkLoaded) {
        try {
          dim.spawnParticle(
            "subo:rift_port",
            { x: info.x + 0.5, y: info.y + 0.1, z: info.z + 0.5 }
          );
        } catch { }
      }

      // 5-second warning (does not need the overworld chunk)
      if (remaining === WARNING_5) {
        for (const p of world.getPlayers()) {
          const data = getPlayerRiftReturn(p);
          if (data && data.riftId === riftId && p.dimension.id === DIMENSION_ID) {
            p.onScreenDisplay.setActionBar("§cRift closing in 5 seconds!");
          }
        }
      }

      // Step-on teleport only possible when the chunk is loaded
      if (!chunkLoaded || isBroken(entity)) continue;

      const players = dim.getPlayers({
        location: { x: info.x + 0.5, y: info.y + 0.5, z: info.z + 0.5 },
        maxDistance: 0.6
      });

      for (const player of players) {
        const py = Math.floor(player.location.y);
        if (py < info.y || py > info.y + 1) continue;
        if (player.dimension.id === DIMENSION_ID) continue;

        const lockedUntil = teleportLock.get(player.id) ?? 0;
        if (now < lockedUntil) continue;

        if (getPlayerRiftReturn(player)) clearPlayerRiftTags(player);

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
    console.warn("[DBG] teleport aborted – port broken");
    return;
  }

  if (player.dimension.id === DIMENSION_ID) {
    console.warn("[DBG] already inside rift dimension – abort");
    return;
  }

  // still respect broken state when we can read the entity
  if (entity && isBroken(entity)) {
    console.warn("[DBG] teleport aborted – port broken");
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

  if (loc) {
    try {
      const block = dim.getBlock(loc);
      if (block?.typeId === RIFT_BLOCK) {
        // Only set inactive when the rift just timed out / was closed normally.
        // Never set "broken" anymore – permanent destruction is handled by the caller.
        if (!wasDestroyed) {
          trySetState(block, "inactive");
        }
      }
    } catch { }
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
// BREAK/PLACE HANDLER
// =============================================================================
export function handleRiftPortBreak(dim, loc) {
  system.run(async () => {
    const entity = getRiftEntityAt(dim, loc);

    // Full cleanup only – no replacement, no visual explosion required
    await forceCloseRift(dim, entity, true, null, loc);
  });
}

export function handleRiftPortPlace(event) {
  if (event.dimension.id === DIMENSION_ID) {   // import DIMENSION_ID if needed
    event.cancel = true;
    // player feedback
    system.run(() => {
      event.player?.onScreenDisplay.setActionBar("§cYou cannot place a Rift Port inside a rift.");
    });
  }
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

  // ------------------------------------------------------------------
  // Always force-load the pad when we are about to change its state
  // (the earlier area may have been created with a null loc)
  // ------------------------------------------------------------------
  const needDestroy = opened >= total && total > 0;
  let destroyAreaId = null;
  let destroyAreaCreated = false;

  if (loc && (insideCorrectRift || needDestroy)) {
    destroyAreaId = `rift_pouch_destroy_${riftId}_${Date.now()}`;
    try {
      const options = {
        dimension: dim,
        from: { x: loc.x - 2, y: loc.y - 2, z: loc.z - 2 },
        to: { x: loc.x + 2, y: loc.y + 2, z: loc.z + 2 }
      };
      if (world.tickingAreaManager.hasCapacity(options)) {
        await world.tickingAreaManager.createTickingArea(destroyAreaId, options);
        destroyAreaCreated = true;
        await system.waitTicks(5);

        // re-fetch entity now that the chunk is guaranteed loaded
        entity = getRiftEntityAt(dim, loc) ?? entity;
      }
    } catch { }
  }

  // ------------------------------------------------------------------
  // Close the rift (return players only when the pouch matches the current one)
  // ------------------------------------------------------------------
  if (insideCorrectRift) {
    await forceCloseRift(dim, entity, false, riftId, loc);
  } else {
    // Different rift (or already closed) – just cancel timer + set inactive
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

  // ------------------------------------------------------------------
  // Last pouch → permanent destruction
  // ------------------------------------------------------------------
  if (needDestroy) {
    player.sendMessage("§5§lAll glitch energy extracted! The island collapses...");

    if (loc) {
      // Re-use / keep a ticking area so the chunk stays loaded for the replacement
      const finalAreaId = `rift_final_${riftId}_${Date.now()}`;
      let finalAreaCreated = false;
      try {
        const options = {
          dimension: dim,
          from: { x: loc.x - 2, y: loc.y - 2, z: loc.z - 2 },
          to: { x: loc.x + 2, y: loc.y + 2, z: loc.z + 2 }
        };
        if (world.tickingAreaManager.hasCapacity(options)) {
          await world.tickingAreaManager.createTickingArea(finalAreaId, options);
          finalAreaCreated = true;
          await system.waitTicks(5);
        }
      } catch { }

      // 1. Full cleanup (entity + island + free ID)
      //    wasDestroyed = true → deletes island & removes entity
      //    but does NOT touch the block state any more
      const entity = getRiftEntityAt(dim, loc);
      await forceCloseRift(dim, entity, true, null, loc);

      // 2. Visual-only explosion
      try {
        dim.spawnParticle("minecraft:large_explosion", {
          x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5
        });
      } catch { }
      try {
        dim.playSound("random.explode", loc, { volume: 1.1, pitch: 0.85 });
        dim.playSound("portal.travel", loc, { volume: 0.6, pitch: 0.55 });
      } catch { }

      // 3. Place the destroyed port (chunk is still force-loaded)
      try {
        const block = dim.getBlock(loc);
        if (block) {
          block.setType("subo:destroyed_rift");
        }
      } catch { }

      if (finalAreaCreated) {
        try { world.tickingAreaManager.removeTickingArea(finalAreaId); } catch { }
      }
    }
  }

  // Clean up both possible ticking areas
  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }
  if (destroyAreaCreated && destroyAreaId) {
    try { world.tickingAreaManager.removeTickingArea(destroyAreaId); } catch { }
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