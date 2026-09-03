import { system } from "@minecraft/server";
import { handleSpawnerInteraction, breakSpawner, placeSpawner } from "./spawner/spawnerLogic.js";
import { replaceWithLootChest } from "./camp/randomChests.js";
import { spawnRandomEnemies } from "./camp/randomMobSpawner.js";
import { handlePortalBreak } from "./portal/portalLogic.js";
import { handlePurifierBreak } from "./purifier/purifierLogic.js";
// import { buildCamp } from "./camp/campBuilder.js";  // for testing


export function registerBlockComponents() {
    system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
        // Chest tiers
        blockComponentRegistry.registerCustomComponent("subo:on_first_tick_chest", {
            onPlace(e) {
                replaceWithLootChest(e.block);
            }
        });

        // Spawner tiers
        blockComponentRegistry.registerCustomComponent("subo:on_first_tick_spawn", {
            onPlace(e) {
                spawnRandomEnemies(e.block, e.dimension);
            }
        });

        blockComponentRegistry.registerCustomComponent("subo:barbarian_block", {
            beforeOnPlayerPlace: (event) => placeSpawner(event, "barbarian"),
            onBreak: (event) => breakSpawner(event),
            onPlayerInteract: (event) => handleSpawnerInteraction(event)
        });

        blockComponentRegistry.registerCustomComponent("subo:archer_block", {
            beforeOnPlayerPlace: (event) => placeSpawner(event, "archer"),
            onBreak: (event) => breakSpawner(event),
            onPlayerInteract: (event) => {
                handleSpawnerInteraction(event);
                // const block = event.block;
                // const { x, y, z } = block.location;
                // buildCamp(block.dimension, x, y, z); // Spawn a cwamp, for testing;
            }
        });

        blockComponentRegistry.registerCustomComponent("subo:dragon_block", {
            beforeOnPlayerPlace: (event) => placeSpawner(event, "dragon"),
            onBreak: (event) => breakSpawner(event),
            onPlayerInteract: (event) => handleSpawnerInteraction(event)
        });

        blockComponentRegistry.registerCustomComponent("subo:purifier_block", {
            onBreak: (event) => {
                const dim = event.block.dimension;
                const loc = event.block.location;
                system.run(() => handlePurifierBreak(dim, loc));
            }
        });

        blockComponentRegistry.registerCustomComponent("subo:portal_block", {
            onBreak: (event) => {
                handlePortalBreak(event);
            }
        });
    });
}