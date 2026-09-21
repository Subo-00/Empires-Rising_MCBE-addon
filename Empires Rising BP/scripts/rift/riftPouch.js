import { system, world, ItemStack } from "@minecraft/server";
import { RIFT_DIMENSION_ID, RIFT_ENTITY } from "../config/riftConfig.js";
import {
  getNum, setNum, blockLoc, getRiftEntityAt,
  getPlayerRiftReturn, clearPlayerRiftTags
} from "./riftHelpers.js";
import { forceCloseRift, activeRifts } from "./riftPort.js";
import { returnPlayerHome } from "./riftTeleport.js";

export async function handleGlitchPouchUse(player, pouch) {
  // 1. Extract riftId from lore
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

  // 2. Consume the pouch
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (inv) inv.setItem(player.selectedSlotIndex, undefined);

  // 3. Give 1-3 random spirits
  const types = ["subo:vigor_spirit", "subo:pyro_spirit", "subo:frost_spirit"];
  const count = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    try { inv?.addItem(new ItemStack(type, 1)); } catch { }
  }
  player.sendMessage(`§dYou extracted ${count} spirit${count > 1 ? "s" : ""} from the pouch.`);

  // feedback
  const p_loc = player.location;
  try {
    player.dimension.spawnParticle("subo:pouch_extract", {
      x: p_loc.x, y: p_loc.y + 1.2, z: p_loc.z
    });
    player.playSound("subo.pouch.extract", { volume: 0.9, pitch: 1.05 });
  } catch { }

  // 4. Progress the correct rift’s counter (NO teleport)
  const dim = world.getDimension("minecraft:overworld");
  let loc = null;
  let entity = null;

  const info = activeRifts.get(riftId);
  if (info) loc = { x: info.x, y: info.y, z: info.z };

  // Force-load pad
  const areaId = `pouch_${riftId}_${Date.now()}`;
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

  // Find the persistence entity
  try {
    for (const e of dim.getEntities({ type: "subo:rift_port_entity" })) {
      if (getNum(e, "riftId:", 0) === riftId) {
        entity = e;
        if (!loc) loc = blockLoc(e);
        break;
      }
    }
  } catch { }

  // Update counters
  let total = 0, opened = 0;
  if (entity?.isValid) {
    total = getNum(entity, "pouchTotal:", 0);
    opened = getNum(entity, "pouchOpened:", 0) + 1;
    setNum(entity, "pouchOpened:", opened);
  }

  if (total > 0) {
    player.sendMessage(`§dGlitch energy extracted (${opened}/${total})`);
  }

  const needDestroy = opened >= total && total > 0;

  // Only destroy the port – do NOT force players out
  await forceCloseRift(dim, entity, needDestroy, riftId, loc);

  if (needDestroy && loc) {
    player.sendMessage("§5§lAll glitch energy extracted! The island collapses...");
    try {
      playRiftFeedback(dim, loc, "subo:rift_destroy", "subo.rift.destroy", 1.15, 0.85);
      dim.playSound("random.explode", loc, { volume: 1.1, pitch: 0.85 });
      dim.playSound("portal.travel", loc, { volume: 0.6, pitch: 0.55 });
      const block = dim.getBlock(loc);
      if (block) block.setType("subo:destroyed_rift");
    } catch { }
  }

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }
}