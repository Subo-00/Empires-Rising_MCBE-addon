import { system, world, ItemStack } from "@minecraft/server";
import { RIFT_ENTITY } from "../config/rift/riftConfig.js";
import { getNum } from "./riftHelpers.js";
import { forceCloseRift } from "./riftPort.js";
import { incrementPouchOpened, getPortLocation } from "./riftIsland.js";

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

  // 4. Progress the correct rift’s counter (scoreboard – works after reload)
  const { total, opened, needDestroy } = incrementPouchOpened(riftId);

  if (total > 0) {
    player.sendMessage(`§dGlitch energy extracted (${opened}/${total})`);
  }

  // Location is also on scoreboard now
  const loc = getPortLocation(riftId);
  const dim = world.getDimension("minecraft:overworld");

  // Optional: still force-load only if we need to change the block state
  let entity = null;
  let areaCreated = false;
  const areaId = `pouch_${riftId}_${Date.now()}`;

  if (loc && needDestroy) {
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

  // Find entity only when we are about to destroy
  if (needDestroy && loc) {
    try {
      for (const e of dim.getEntities({ type: RIFT_ENTITY, location: loc, maxDistance: 1 })) {
        if (getNum(e, "riftId:", 0) === riftId) {
          entity = e;
          break;
        }
      }
    } catch { }
  }

  // playFeedback=false for destroy: visual feedback is deferred until the player returns to the port
  await forceCloseRift(dim, entity, needDestroy, riftId, loc, !needDestroy);

  if (needDestroy && loc) {
    player.sendMessage("§5§lAll glitch energy extracted! The island collapses...");
    try {
      // Logical destroy only – no particles/sounds here (player is still inside the rift)
      const block = dim.getBlock(loc);
      if (block) block.setType("subo:destroyed_rift");
    } catch { }
  }

  if (areaCreated) {
    try { world.tickingAreaManager.removeTickingArea(areaId); } catch { }
  }
}