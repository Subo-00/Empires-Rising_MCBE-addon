import { system } from "@minecraft/server";

import { registerBlockComponents } from "./blockComponents.js";
import { initCampSystem } from "./camp/campSystem.js";
import { initEntityTicks } from "./entityTicks.js";
import { resumeAllQueuedSpawners } from "./spawner//troopLogic.js";

// Side-effect only modules (they register themselves)
import "./specialMobDrops.js";
import "./items/milkPotion.js";
import "./items/potionBlaster.js";
import "./items/troopHorn.js";
import "./rift/rift_dimension.js";

// -------------------------------------------------------
// Bootstrap
// -------------------------------------------------------

registerBlockComponents();
initCampSystem();
initEntityTicks();

// Resume any queues that were interrupted by a server restart / chunk unload.
system.run(() => resumeAllQueuedSpawners());