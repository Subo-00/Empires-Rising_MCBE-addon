import { world, system, BlockPermutation } from "@minecraft/server";
import { handleSpawnerInteraction, breakSpawner, placeSpawner } from "./spawnerLogic.js";
import { buildCamp } from "./campBuilder.js";
import { scanTick, workerTick } from "./campRegionScheduler.js";
import { setupScoreboard, cleanupScoreboard } from "./tickingAreaTracker.js";
import { resumeAllQueuedSpawners } from "./troopLogic.js";
import { replaceWithLootChest } from "./randomChests.js";
import { spawnRandomEnemies } from "./randomMobSpawner.js";
import { lavaGolemTick } from "./lavaGolem.js";
import { fireSpiritTick } from "./fireSpirit.js";
import { darkKnightTick } from "./darkKnight.js";
import { dragonTick } from "./dragon.js";
import { handlePortalBreak } from "./portalLogic.js";
import { handlePurifierBreak } from "./purifierLogic.js";
import "./specialMobDrops.js";
import "./milkPotion.js";
import "./potionBlaster.js";
import "./trumpet.js";


// Block component registration
system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
    // Chest tiers (all 3 share this component; tier is read from typeId)
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
            // block.dimension.runCommand(
            //     `structure load subo:camp_generic_tower_8_e_15x15 ${x} ${y} ${z} 0_degrees none`
            // );
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

// Resume any queues that were interrupted by a server restart / chunk unload.
system.run(() => resumeAllQueuedSpawners());

system.runInterval(() => {
    lavaGolemTick();
    fireSpiritTick();
    darkKnightTick();
    dragonTick();
}, 5);


// Init and handle ticking areas through scoreboards
world.afterEvents.worldLoad.subscribe(() => {
    setupScoreboard();
    cleanupScoreboard();
});

// ---------------------------------------------------------------------------
// How often to scan around players for new regions to queue.
const SCAN_INTERVAL_TICKS = 40;

// How often the worker tries to pick the next queued region.
const WORKER_INTERVAL_TICKS = 5;

// -------------------------------------------------------
// Player scanner
// -------------------------------------------------------

// Runs every SCAN_INTERVAL_TICKS ticks.
// For each player, scans a square of regions centered on their current region
// and enqueues any that haven't been processed or queued yet.
//
// Important behavior:
// - Scanning is per-player; each player independently contributes to the queue.
// - The player's own region (rx=0, rz=0) is always included.
// - Regions are enqueued with priority based on distance + movement direction.
// - Actual processing is handled separately by the worker loop below.
system.runInterval(() => {
    const players = world.getPlayers();
    if (players.length === 0) return;

    scanTick(players);
}, SCAN_INTERVAL_TICKS);

// Worker loop: runs every WORKER_INTERVAL_TICKS ticks.
// Tries to fill all available worker slots in one go.
// Example: if MAX_CONCURRENT_WORKERS=3 and activeWorkers=1, this fires twice,
// starting two new regions immediately rather than waiting for the next interval.
system.runInterval(() => {
    workerTick();
}, WORKER_INTERVAL_TICKS);
// ----------------------------------------------------------------------------
