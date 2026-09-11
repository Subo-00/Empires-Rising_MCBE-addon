import { system, world, ItemStack } from "@minecraft/server";
import { DIMENSION_ID, RIFT_BLOCK, RIFT_ENTITY } from "../config/riftConfig.js";
import {
  getNum, setNum, blockLoc, getRiftEntityAt,
  getPlayerRiftReturn, trySetState
} from "./riftHelpers.js";
import { forceCloseRift, activeRifts } from "./riftPort.js";

export async function handleGlitchPouchUse(player, pouch) {
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
      await forceCloseRift(dim, entity, true, riftId, loc);

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