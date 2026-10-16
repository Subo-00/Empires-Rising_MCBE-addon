import { system, world, CommandPermissionLevel } from "@minecraft/server";
import { buildCamp } from "./camp/campBuilder.js";  // for testing


system.beforeEvents.startup.subscribe((init) => {
  const cmd = {
    name: "subo:hello",
    description: "My custom command",
    permissionLevel: CommandPermissionLevel.Any
  };
  init.customCommandRegistry.registerCommand(cmd, (origin) => {
    const player = origin.sourceEntity;
    player.sendMessage("Hello from my custom command!");

    system.run(() => {
      const { x, y, z } = player.location;
      // placeNetherFortress(x, y, z);
      testDynamicProperties(player);
      // buildCamp(player.dimension, x, y, z, true);
    });
  });
});

async function placeNetherFortress(baseX, baseY, baseZ, width = 150, depth = 150) {
  const dim = world.getDimension("minecraft:overworld");

  // --- 1. Create one ticking area covering the full build footprint ---
  const taId = "nether_fortress_ta";
  world.sendMessage("§eLoading chunks for nether fortress...");

  await world.tickingAreaManager.createTickingArea(taId, {
    dimension: dim,
    from: { x: baseX, y: baseY, z: baseZ },
    to: { x: baseX + width - 1, y: baseY, z: baseZ + depth - 1 },
  });

  const pieces = [
    { name: "rift_fort:0_0_rift_fort", x: 0, z: 0 },
    { name: "rift_fort:0_50_rift_fort", x: 0, z: 50 },
    { name: "rift_fort:100_50_rift_fort", x: 100, z: 50 },
    { name: "rift_fort:50_0_rift_fort", x: 50, z: 0 },
    { name: "rift_fort:50_100_rift_fort", x: 50, z: 100 },
    { name: "rift_fort:50_50_rift_fort", x: 50, z: 50 },
  ];
  // const pieces = [ // 2
  //   { name: "rift_fort_2:0_0_rift_fort_2", x: 0, z: 0 },
  //   { name: "rift_fort_2:0_50_rift_fort_2", x: 0, z: 50 },
  //   { name: "rift_fort_2:100_50_rift_fort_2", x: 100, z: 50 },
  //   { name: "rift_fort_2:50_0_rift_fort_2", x: 50, z: 0 },
  //   { name: "rift_fort_2:50_100_rift_fort_2", x: 50, z: 100 },
  //   { name: "rift_fort_2:50_50_rift_fort_2", x: 50, z: 50 },
  // ];

  system.run(() => {
    for (const p of pieces) {
      dim.runCommand(
        `structure load ${p.name} ${baseX + p.x} ${baseY} ${baseZ + p.z}`
      );
    }
    world.sendMessage(`§aPlaced nether fortress at (${baseX}, ${baseY}, ${baseZ})`);
  });

  // --- 3. Remove the ticking area ---
  world.tickingAreaManager.removeTickingArea(taId);

}

/**
 * Test function – only works on non-stackable items
 * (max stack size === 1)
 */
export function testDynamicProperties(player) {
  const inventory = player.getComponent("inventory");
  if (!inventory || !inventory.container) {
    player.sendMessage("§cNo inventory component found!");
    return;
  }

  const container = inventory.container;
  const size = container.size;

  let totalItems = 0;
  let nonStackableItems = 0;
  let totalPropsWritten = 0;
  let totalPropsRead = 0;

  // ---------- WRITE PHASE ----------
  for (let slot = 0; slot < size; slot++) {
    const item = container.getItem(slot);
    if (!item) continue;

    totalItems++;

    // Skip stackable items
    if (item.maxAmount > 1) {
      console.warn(`§7[SKIP] Slot ${slot} (${item.typeId}) is stackable (maxAmount=${item.maxAmount})`);
      continue;
    }

    nonStackableItems++;
    console.warn(`§a[WRITE] Slot ${slot} (${item.typeId}) – writing 500 properties...`);

    for (let i = 0; i < 500; i++) {
      const key = `test:prop_${i}`;
      const value = `slot${slot}_value_${i}`;
      item.setDynamicProperty(key, value);
      totalPropsWritten++;
    }

    // Write the modified item back
    container.setItem(slot, item);
  }

  console.warn(`§e[WRITE SUMMARY] Total items in inventory: ${totalItems}`);
  console.warn(`§e[WRITE SUMMARY] Non-stackable items processed: ${nonStackableItems}`);
  console.warn(`§e[WRITE SUMMARY] Properties written: ${totalPropsWritten}`);

  if (nonStackableItems === 0) {
    console.warn("§cNo non-stackable items found! Put swords, tools, armor, etc. in your inventory and try again.");
    return;
  }

  // ---------- READ PHASE ----------
  system.runTimeout(() => {
    for (let slot = 0; slot < size; slot++) {
      const item = container.getItem(slot);
      if (!item || item.maxAmount > 1) continue;

      const ids = item.getDynamicPropertyIds();
      const byteCount = item.getDynamicPropertyTotalByteCount();

      console.warn(`§b[READ] Slot ${slot} (${item.typeId}) → ${ids.length} properties, ${byteCount} bytes`);

      // Uncomment the next lines if you really want to see every single property
      // for (const id of ids) {
      //     console.warn(`    ${id} = ${item.getDynamicProperty(id)}`);
      // }

      totalPropsRead += ids.length;
    }

    console.warn("§d========== FINAL RESULT ==========");
    console.warn(`§dItems in inventory: ${totalItems}`);
    console.warn(`§dNon-stackable items tested: ${nonStackableItems}`);
    console.warn(`§dProperties written: ${totalPropsWritten}`);
    console.warn(`§dProperties read back: ${totalPropsRead}`);
    console.warn(`§dExpected: ${nonStackableItems * 500}`);

    if (totalPropsRead === nonStackableItems * 500) {
      console.warn("§a✓ SUCCESS – all 500 properties per non-stackable item were stored and retrieved!");
    } else {
      console.warn("§c✗ MISMATCH – some properties are missing or were not written.");
    }
  }, 5);
}