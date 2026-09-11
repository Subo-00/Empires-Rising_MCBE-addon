import { system, world, ItemStack } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { getStorageLocation, setTag, getTag } from "../spawner/spawnerHelpers.js";

import {
  DIMENSION_ID, RIFT_BLOCK, RIFT_ENTITY,
  LAPIS_ID, SECONDS_PER_LAPIS, MAX_OPEN_SECONDS, TICKS_PER_SECOND,
  WARNING_15, WARNING_5
} from "../config/riftConfig.js";

import {
  trySetState, getNum, setNum, ensureId, getRiftEntityAt,
  isActive, isBroken, clearRiftState, blockLoc,
  clearPlayerRiftTags, setPlayerRiftTags, getPlayerRiftReturn,
  countItem, removeItemAmount
} from "./riftHelpers.js";

import { getNextRiftId, ensureIsland, deleteIsland } from "./riftIsland.js";
import { teleportLock, teleportPlayerToRift, returnPlayerHome } from "./riftTeleport.js";
import { handleGlitchPouchUse } from "./riftPouch.js";


// riftId → { timeoutId, x, y, z }
export const activeRifts = new Map();

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
    player.onScreenDisplay.setActionBar(`§dRift #${riftIdForUi} open – §f${secs}s §dremaining`);
    return;
  }

  const lapisCount = countItem(player, LAPIS_ID);
  if (lapisCount === 0) {
    player.onScreenDisplay.setActionBar("§cYou need Lapis Lazuli to open a rift.");
    return;
  }

  const maxSeconds = Math.min(MAX_OPEN_SECONDS, lapisCount * SECONDS_PER_LAPIS);

  const title = riftIdForUi
    ? `§5✦ Open Rift Port #${riftIdForUi} ✦`
    : "§5✦ Open Rift Port ✦";

  const form = new ModalFormData()
    .title(title)
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

      // Keep the persistent tag in sync so recovery works after a restart
      if (chunkLoaded && entity && entity.isValid) {
        setNum(entity, "remaining:", remaining);
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

// =============================================================================
// FORCE CLOSE / RETURN ALL PLAYERS
// =============================================================================
export async function forceCloseRift(dim, entity, wasDestroyed, forcedRiftId = null, forcedLoc = null) {
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
