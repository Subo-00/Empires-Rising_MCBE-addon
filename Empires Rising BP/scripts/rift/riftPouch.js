import { system, world, ItemStack } from "@minecraft/server";
import { DIMENSION_ID, RIFT_BLOCK, RIFT_ENTITY } from "../config/riftConfig.js";
import {
  getNum, setNum, blockLoc, getRiftEntityAt,
  getPlayerRiftReturn, trySetState
} from "./riftHelpers.js";
import { forceCloseRift, activeRifts } from "./riftPort.js";

export async function handleGlitchPouchUse(player, pouch) {
  // -------------------------------------------------------------------------
  // 1. Extract riftId from the pouch lore
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 2. Always give the loot and consume the pouch (even if something fails later)
  // -------------------------------------------------------------------------
  const loot = new ItemStack("minecraft:netherite_ingot", 1);
  player.getComponent("inventory")?.container.addItem(loot);

  const inv = player.getComponent("inventory")?.container;
  if (inv) inv.setItem(player.selectedSlotIndex, undefined);

  // -------------------------------------------------------------------------
  // 3. Determine if the player is currently inside the correct rift
  // -------------------------------------------------------------------------
  const returnData = getPlayerRiftReturn(player);
  const insideCorrectRift =
    returnData &&
    returnData.riftId === riftId &&
    player.dimension.id === DIMENSION_ID;

  // -------------------------------------------------------------------------
  // 4. Resolve the overworld pad location of the POUCH'S rift only
  // -------------------------------------------------------------------------
  let loc = null;

  // 4a. Player is currently tied to this exact riftId
  if (returnData && returnData.riftId === riftId) {
    loc = { x: returnData.x, y: returnData.y, z: returnData.z };
  }

  // 4b. The rift is still in the active map
  if (!loc) {
    const info = activeRifts.get(riftId);
    if (info) {
      loc = { x: info.x, y: info.y, z: info.z };
    }
  }

  // NOTE: We deliberately do NOT fall back to returnData when the riftId
  // does not match. That was the bug that made foreign pouches progress
  // the current rift.

  const dim = world.getDimension("minecraft:overworld");

  // -------------------------------------------------------------------------
  // 5. Force-load the correct pad (only if we know its location)
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 6. Find the persistence entity that belongs to this pouch’s riftId
  // -------------------------------------------------------------------------
  let entity = null;

  // First try the location we just loaded
  if (loc) {
    entity = getRiftEntityAt(dim, loc);
    // Extra safety: make sure the entity we found actually has the right riftId
    if (entity && getNum(entity, "riftId:", 0) !== riftId) {
      entity = null;
    }
  }

  // Fallback scan – only accept an entity that really belongs to this riftId
  if (!entity) {
    try {
      for (const e of dim.getEntities({ type: RIFT_ENTITY })) {
        if (getNum(e, "riftId:", 0) === riftId) {
          entity = e;
          const bl = blockLoc(e);
          if (bl) loc = bl;
          break;
        }
      }
    } catch { }
  }

  // Final recovery of location from the entity tags
  if (entity && !loc) {
    loc = blockLoc(entity);
  }

  // -------------------------------------------------------------------------
  // 7. Update pouch counters
  // -------------------------------------------------------------------------
  let total = 0;
  let opened = 0;

  if (entity && entity.isValid) {
    total = getNum(entity, "pouchTotal:", 0);
    opened = getNum(entity, "pouchOpened:", 0) + 1;
    setNum(entity, "pouchOpened:", opened);
  }
  if (total > 0) {
    player.sendMessage(`§dGlitch Pouch opened (${opened}/${total})`);
  } else {
    player.sendMessage(`§dGlitch Pouch opened (rift already closed or unknown)`);
  }

  // -------------------------------------------------------------------------
  // 8. Decide what kind of close is required and perform it only once
  // -------------------------------------------------------------------------
  const needDestroy = opened >= total && total > 0;
  const shouldForceClose = insideCorrectRift || needDestroy;

  if (shouldForceClose) {
    // needDestroy === true  → permanent destruction (island + entity removed)
    // needDestroy === false → normal close (just return players + set inactive)
    await forceCloseRift(dim, entity, needDestroy, riftId, loc);
  } else {
    // Pouch belongs to a different / already-closed rift
    // → only cancel its timer and mark the pad inactive
    const info = activeRifts.get(riftId);
    if (info) {
      try { system.clearRun(info.timeoutId); } catch { }
      activeRifts.delete(riftId);
    }
    if (entity && entity.isValid) {
      setNum(entity, "remaining:", 0);
      setNum(entity, "total:", 0);
    }
    if (loc) {
      try {
        const block = dim.getBlock(loc);
        if (block?.typeId === RIFT_BLOCK) {
          trySetState(block, "inactive");
        }
      } catch { }
    }
  }

  // -------------------------------------------------------------------------
  // 9. Visual feedback + permanent block replacement (only on last pouch)
  // -------------------------------------------------------------------------
  if (needDestroy && loc) {
    player.sendMessage("§5§lAll glitch energy extracted! The island collapses...");

    // Short final area so the block swap is reliable even on slow disks
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
        await system.waitTicks(3);
      }
    } catch { }

    // Explosion particles + sounds
    try {
      dim.spawnParticle("minecraft:large_explosion", {
        x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5
      });
    } catch { }
    try {
      dim.playSound("random.explode", loc, { volume: 1.1, pitch: 0.85 });
      dim.playSound("portal.travel", loc, { volume: 0.6, pitch: 0.55 });
    } catch { }

    // Replace the port with the destroyed block
    try {
      const block = dim.getBlock(loc);
      if (block) block.setType("subo:destroyed_rift");
    } catch { }

    if (finalAreaCreated) {
      try { world.tickingAreaManager.removeTickingArea(finalAreaId); } catch { }
    }
  }

  // -------------------------------------------------------------------------
  // 10. Clean up the temporary ticking area we created at the start
  // -------------------------------------------------------------------------
  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
    // Also remove the possible "_retry" area
    try { world.tickingAreaManager.removeTickingArea(areaId + "_retry"); } catch { }
  }
}