import { system, world, ItemStack } from "@minecraft/server";
import { getStorageLocation, setTag } from "../spawner/spawnerHelpers.js";

import {
  DIMENSION_ID, RIFT_BLOCK, RIFT_ENTITY,
  RIFT_KEY_ID, OPEN_DURATION_TICKS,
  VALID_SPAWN_BLOCKS, FORCED_SPAWN_MOBS, ALLOWED_RIFT_MOBS
} from "../config/riftConfig.js";

import {
  trySetState, getNum, setNum, getRiftEntityAt,
  isActive, isBroken, clearRiftState, blockLoc,
  clearPlayerRiftTags, getPlayerRiftReturn,
} from "./riftHelpers.js";
import { handleGlitchPouchUse } from "./riftPouch.js";

import { getNextRiftId, ensureIsland, freeRiftId } from "./riftIsland.js";
import { teleportLock, teleportPlayerToRift, returnPlayerHome } from "./riftTeleport.js";
import { handleSpiritUse, startSpiritTicker, recoverSpirits } from "./riftSpirits.js";

// riftId → { timeoutId, x, y, z }
export const activeRifts = new Map();

// Prevents recovery / step-ticker from racing with forceCloseRift
const closingRifts = new Set();

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

    // Spirit items (all three share the same use handler)
    ev.itemComponentRegistry.registerCustomComponent("subo:spirit_use", {
      onUse(event) {
        const player = event.source;
        const item = event.itemStack;
        if (!player || !item) return;
        handleSpiritUse(player, item);
      }
    });

  });

  startSpiritTicker();

  // Start the lightweight dimension ticker (it self-idles when no-one is inside)
  startRiftDimensionTicker();
}

// -----------------------------------------------------------------------------
// RECOVERY (server restart / chunk reload)
// -----------------------------------------------------------------------------
const recoveredRifts = new Set();   // prevent double-recovery of the same riftId

function recoverSingleRift(entity) {
  if (!entity || !entity.isValid) return;

  const riftId = getNum(entity, "riftId:", 0);
  if (!riftId || recoveredRifts.has(riftId)) return;

  // Already being tracked or currently closing → ignore
  if (activeRifts.has(riftId) || closingRifts.has(riftId)) {
    recoveredRifts.add(riftId);
    return;
  }

  recoveredRifts.add(riftId);

  const loc = blockLoc(entity);
  if (!loc) return;

  const dim = world.getDimension("minecraft:overworld");
  let block = null;
  try { block = dim.getBlock(loc); } catch { }

  // Permanently broken → convert to destroyed block & clean up
  if (isBroken(entity)) {
    if (block?.typeId === RIFT_BLOCK) {
      try { block.setType("subo:destroyed_rift"); } catch { }
    }
    if (riftId) freeRiftId(riftId);
    clearRiftState(entity);
    try { entity.remove(); } catch { }
    return;
  }

  // ANY previous open state is discarded on load / restart.
  // Just force-close the port (players stay inside until they use a pouch).
  forceCloseRift(dim, entity, false, riftId, { ...loc });
}

function recoverStuckPlayers() {
  for (const p of world.getPlayers()) {
    if (p.dimension.id !== DIMENSION_ID) continue;

    const data = getPlayerRiftReturn(p);
    if (!data) {
      // no return tag at all → true emergency (should never happen in normal play)
      p.teleport({ x: 0, y: 100, z: 0 }, { dimension: world.getDimension("minecraft:overworld") });
      p.sendMessage("§cYou were stuck in a rift. Returned to spawn.");
    }
    // otherwise leave them alone – they stay in the island until a spirit is used
    // or the port is destroyed
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
  recoverSpirits();
}, 60);   // 3 seconds – safe for most servers

world.afterEvents.entityLoad.subscribe((ev) => {
  if (ev.entity?.typeId !== RIFT_ENTITY) return;
  // small delay so tags are readable
  system.runTimeout(() => recoverSingleRift(ev.entity), 5);
});

// =============================================================================
// Prevent any block place / break while inside the rift dimension
// PLACEMENT → spawn persistence entity
// =============================================================================
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  if (ev.player?.dimension?.id === DIMENSION_ID) {
    const placedType = ev.block.type.id;      // capture the block type

    // Skip the multi-part portal – it handles itself
    if (placedType === "subo:portal") return;

    // undo the placement
    try {
      ev.block.setType("minecraft:air");
    } catch { }
    system.run(() => {
      const player = ev.player;
      player.onScreenDisplay.setActionBar("§cYou cannot place blocks inside a rift.");
      // give the item back
      const inv = player.getComponent("minecraft:inventory")?.container;
      if (inv) {
        try {
          const item = new ItemStack(placedType, 1);
          const leftover = inv.addItem(item);
          // If addItem returns something, inventory was full
          if (leftover) {
            dim.spawnItem(leftover, player.location);
          }
        } catch (e) {
          console.warn(e);
        }
      }
    });
    return;
  }


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

world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.player?.dimension?.id === DIMENSION_ID) {
    ev.cancel = true;
    system.run(() => {
      ev.player.onScreenDisplay.setActionBar("§cYou cannot break blocks inside a rift.");
    });
  }
});

// =============================================================================
// Prevent natural mob spawns in the rift dimension
// Only allow the explicit whitelist (everything else is removed)
// =============================================================================


world.afterEvents.entitySpawn.subscribe((event) => {
  const { entity } = event;
  if (!entity?.isValid) return;
  if (entity.dimension.id !== DIMENSION_ID) return;

  // Keep players, items, xp, and the whitelist; remove everything else
  if (
    entity.typeId === "minecraft:player" ||
    entity.typeId === "minecraft:item" ||
    entity.typeId === "minecraft:xp_orb" ||
    ALLOWED_RIFT_MOBS.has(entity.typeId)
  ) {
    return;
  }

  try { entity.remove(); } catch { }
});

// =============================================================================
// INTERACTION → activation form
// =============================================================================
const formOpenPlayers = new Set();

export function openRiftPort(player, loc, dimId) {
  const dim = world.getDimension(dimId);
  const block = dim.getBlock(loc);
  if (!block || block.typeId !== RIFT_BLOCK) return;

  let entity = getRiftEntityAt(dim, loc);

  // Already broken?
  if (isBroken(entity) || block.permutation.getState("subo:state") === "broken") {
    player.onScreenDisplay.setActionBar("§cThis port is broken.");
    try {
      if (entity?.isValid) {
        clearRiftState(entity);
        entity.remove();
      }
    } catch { }
    try {
      block.setType("minecraft:air");
      const inv = player.getComponent("minecraft:inventory")?.container;
      if (inv) inv.addItem(new ItemStack(RIFT_BLOCK, 1));
    } catch { }
    return;
  }

  // Already open?
  const riftIdForUi = getNum(entity, "riftId:", 0);
  if (activeRifts.has(riftIdForUi) || isActive(entity)) {
    player.onScreenDisplay.setActionBar("§dRift is already open.");
    return;
  }

  // Must be holding a Rift Key in the selected slot
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;

  const held = inv.getItem(player.selectedSlotIndex);
  if (!held || held.typeId !== RIFT_KEY_ID) {
    player.onScreenDisplay.setActionBar("§cYou need to hold a Rift Key to open a port.");
    return;
  }

  // Consume one from the held stack
  if (held.amount > 1) {
    held.amount -= 1;
    inv.setItem(player.selectedSlotIndex, held);
  } else {
    inv.setItem(player.selectedSlotIndex, undefined);
  }

  // Make sure the persistence entity exists
  if (!entity || !entity.isValid) {
    entity = dim.spawnEntity(RIFT_ENTITY, getStorageLocation(block));
    setTag(entity, "bx:", loc.x);
    setTag(entity, "by:", loc.y);
    setTag(entity, "bz:", loc.z);
  }

  activateRift(dim, block, entity);
  player.playSound("random.pop");
  player.onScreenDisplay.setActionBar("§dRift opened for 10 seconds");
}

async function activateRift(dim, block, entity) {
  if (!entity || !entity.isValid) {
    entity = getRiftEntityAt(dim, block.location);
    if (!entity || !entity.isValid) {
      entity = dim.spawnEntity(RIFT_ENTITY, getStorageLocation(block));
      setTag(entity, "bx:", block.location.x);
      setTag(entity, "by:", block.location.y);
      setTag(entity, "bz:", block.location.z);
    }
  }

  let riftId = getNum(entity, "riftId:", 0);
  let shouldBuildBox = true;

  if (!riftId) {
    const next = getNextRiftId();
    riftId = next.id;
    shouldBuildBox = next.shouldBuildBox;
    setNum(entity, "riftId:", riftId);
  }

  // Store return location (useful for pouch / recovery)
  setTag(entity, "returnX:", block.location.x);
  setTag(entity, "returnY:", block.location.y);
  setTag(entity, "returnZ:", block.location.z);

  const fogOptions = [
    "minecraft:fog_hell",
    "minecraft:fog_soulsand_valley",
    "minecraft:fog_basalt_deltas"
  ];
  setTag(entity, "fog:", fogOptions[Math.floor(Math.random() * fogOptions.length)]);

  const islandData = await ensureIsland(riftId, entity, shouldBuildBox);

  // only set / reset pouch counters when the island was just generated
  if (islandData.pouchCount > 0) {
    setNum(entity, "pouchTotal:", islandData.pouchCount);
    setNum(entity, "pouchOpened:", 0);
  }

  // NO longer store remaining / total – the open timer is ephemeral
  // (keep a tiny in-memory entry for the 10 s window)

  const timeoutId = system.runTimeout(() => {
    activeRifts.delete(riftId);
    // Only close the port if the chunk is still loaded.
    // If it unloaded, the next entityLoad will close it.
    const d = world.getDimension("minecraft:overworld");
    let ent = null;
    try { ent = getRiftEntityAt(d, block.location); } catch { }
    forceCloseRift(d, ent, false, riftId, { ...block.location });
  }, OPEN_DURATION_TICKS);

  activeRifts.set(riftId, {
    timeoutId,
    x: block.location.x,
    y: block.location.y,
    z: block.location.z,
    endTick: system.currentTick + OPEN_DURATION_TICKS
  });

  trySetState(block, "active");
  startStepOnTicker();
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
      // NEW: skip if this rift is currently being closed
      if (closingRifts.has(riftId)) continue;

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
      // (only while we are still the authoritative owner)
      if (chunkLoaded && entity && entity.isValid && activeRifts.has(riftId) && !closingRifts.has(riftId)) {
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
// RIFT DIMENSION RULES (forced spawns around players)
// Global ticker every 10 s – only does work while ≥1 player is inside
// =============================================================================
let riftDimRunId = null;

/**
 * Try to place one mob in a random valid spot near the player.
 * Returns true if a mob was successfully spawned.
 */
function tryPlaceOneMobNear(player) {
  const dim = player.dimension;
  const loc = player.location;
  const playerY = Math.floor(loc.y);

  // Up to 12 attempts to find a valid block
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 2 + Math.random() * 8; // 2–10 blocks
    const x = Math.floor(loc.x + Math.cos(angle) * dist);
    const z = Math.floor(loc.z + Math.sin(angle) * dist);

    // Y must be player Y ± 2
    for (let dy = -2; dy <= 2; dy++) {
      const groundY = playerY + dy;
      const ground = dim.getBlock({ x, y: groundY, z });
      const space1 = dim.getBlock({ x, y: groundY + 1, z });
      const space2 = dim.getBlock({ x, y: groundY + 2, z });

      if (
        ground &&
        VALID_SPAWN_BLOCKS.has(ground.typeId) &&
        space1?.isAir &&
        space2?.isAir
      ) {
        const mobId = FORCED_SPAWN_MOBS[Math.floor(Math.random() * FORCED_SPAWN_MOBS.length)];
        try {
          dim.spawnEntity(mobId, { x: x + 0.5, y: groundY + 1, z: z + 0.5 });
          return true;
        } catch { }
      }
    }
  }
  return false;
}

/**
 * Spawn 1–2 random forced mobs around a single player.
 */
function spawnForcedMobsAround(player) {
  const count = 1 + Math.floor(Math.random() * 2); // 1 or 2
  for (let i = 0; i < count; i++) {
    tryPlaceOneMobNear(player);
  }
}

function startRiftDimensionTicker() {
  if (riftDimRunId !== null) return;
  // 200 ticks = 10 seconds
  riftDimRunId = system.runInterval(() => {
    const playersInRift = world.getPlayers().filter(p => p.dimension.id === DIMENSION_ID);
    if (playersInRift.length === 0) return; // cheap early-out – no work when empty

    for (const player of playersInRift) {
      spawnForcedMobsAround(player);
    }
  }, 200);
}

function stopRiftDimensionTicker() {
  if (riftDimRunId === null) return;
  system.clearRun(riftDimRunId);
  riftDimRunId = null;
}

// =============================================================================
// FORCE CLOSE / RETURN ALL PLAYERS
// =============================================================================
export async function forceCloseRift(dim, entity, wasDestroyed, forcedRiftId = null, forcedLoc = null) {
  const riftId = forcedRiftId
    ?? (entity ? getNum(entity, "riftId:", 0) : 0);

  if (!riftId) return;

  if (closingRifts.has(riftId)) return;
  closingRifts.add(riftId);

  // Cancel any pending 10 s timer
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

  // Temporary load of the pad only (so we can change the block state)
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

  // Zero any leftover tags
  let targetEntity = (entity && entity.isValid) ? entity : null;
  if (!targetEntity && loc) {
    try { targetEntity = getRiftEntityAt(dim, loc); } catch { }
  }
  if (targetEntity?.isValid) {
    // We no longer store remaining/total, but clear just in case
    setNum(targetEntity, "remaining:", 0);
    setNum(targetEntity, "total:", 0);
  }

  // Set the block state
  if (loc) {
    try {
      const block = dim.getBlock(loc);
      if (block?.typeId === RIFT_BLOCK) {
        if (!wasDestroyed) {
          trySetState(block, "inactive");
        }
        // (when wasDestroyed the caller will replace it with destroyed_rift)
      }
    } catch { }
  }

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }

  if (wasDestroyed) {
    if (riftId) freeRiftId(riftId);

    const toRemove = (targetEntity?.isValid) ? targetEntity
      : (entity?.isValid) ? entity : null;
    if (toRemove) {
      clearRiftState(toRemove);
      try { toRemove.remove(); } catch { }
    }
  }

  closingRifts.delete(riftId);
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
