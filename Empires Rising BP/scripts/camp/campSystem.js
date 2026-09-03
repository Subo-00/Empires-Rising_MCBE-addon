import { world, system } from "@minecraft/server";
import { scanTick, workerTick } from "./campRegionScheduler.js";
import { setupScoreboard, cleanupScoreboard } from "./helpers/tickingAreaTracker.js";

// How often to scan around players for new regions to queue.
const SCAN_INTERVAL_TICKS = 40;

// How often the worker tries to pick the next queued region.
const WORKER_INTERVAL_TICKS = 5;

export function initCampSystem() {
    // Scoreboard + cleanup on world load
    world.afterEvents.worldLoad.subscribe(() => {
        setupScoreboard();
        cleanupScoreboard();
    });

    // Player region scanner
    system.runInterval(() => {
        const players = world.getPlayers();
        if (players.length === 0) return;
        scanTick(players);
    }, SCAN_INTERVAL_TICKS);

    // Worker loop
    system.runInterval(() => {
        workerTick();
    }, WORKER_INTERVAL_TICKS);
}