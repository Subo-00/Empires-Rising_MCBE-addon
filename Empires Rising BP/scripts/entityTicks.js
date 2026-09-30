import { system } from "@minecraft/server";
import { lavaGolemTick } from "./entities/lavaGolem.js";
import { fireSparkTick } from "./entities/fireSpark.js";
import { darkKnightTick } from "./entities/darkKnight.js";
import { dragonTick } from "./entities/dragon.js";

export function initEntityTicks() {
    system.runInterval(() => {
        const tick = system.currentTick;

        lavaGolemTick(tick);
        fireSparkTick();
        darkKnightTick(tick);
        dragonTick(tick);
    }, 5);
}