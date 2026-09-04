import { system } from "@minecraft/server";
import { lavaGolemTick } from "./entities/lavaGolem.js";
import { fireSpiritTick } from "./entities/fireSpirit.js";
import { darkKnightTick } from "./entities/darkKnight.js";
import { dragonTick } from "./entities/dragon.js";

export function initEntityTicks() {
    system.runInterval(() => {
        lavaGolemTick();
        fireSpiritTick();
        darkKnightTick();
        dragonTick();
    }, 5);
}