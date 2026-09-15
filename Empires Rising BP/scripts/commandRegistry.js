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
      placeNetherFortress(x, y, z);
    });
    // buildCamp(player.dimension, x, y, z, true);
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

  // const pieces = [  // new 1
  //   { name: "test:0_0_rift_fort", x: 0, z: 0 },
  //   { name: "test:0_50_rift_fort", x: 0, z: 50 },
  //   { name: "test:100_50_rift_fort", x: 100, z: 50 },
  //   { name: "test:50_0_rift_fort", x: 50, z: 0 },
  //   { name: "test:50_100_rift_fort", x: 50, z: 100 },
  //   { name: "test:50_50_rift_fort", x: 50, z: 50 },
  // ];
  const pieces = [ // 2
    { name: "rift_fort_2:0_0_rift_fort_2", x: 0, z: 0 },
    { name: "rift_fort_2:0_50_rift_fort_2", x: 0, z: 50 },
    { name: "rift_fort_2:100_50_rift_fort_2", x: 100, z: 50 },
    { name: "rift_fort_2:50_0_rift_fort_2", x: 50, z: 0 },
    { name: "rift_fort_2:50_100_rift_fort_2", x: 50, z: 100 },
    { name: "rift_fort_2:50_50_rift_fort_2", x: 50, z: 50 },
  ];
  // const pieces = [  // 1 
  //   { name: "rift_fort:0_50_rift_fort", x: 0, z: 50 },
  //   { name: "rift_fort:50_0_rift_fort", x: 50, z: 0 },
  //   { name: "rift_fort:55_50_rift_fort", x: 55, z: 50 },
  //   { name: "rift_fort:59_105_rift_fort", x: 59, z: 105 },
  //   { name: "rift_fort:100_55_rift_fort", x: 100, z: 55 },
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