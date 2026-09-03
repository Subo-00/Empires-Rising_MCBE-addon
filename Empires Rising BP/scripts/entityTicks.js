import { system } from "@minecraft/server";
import { lavaGolemTick } from "./bosses/lavaGolem.js";
import { fireSpiritTick } from "./bosses/fireSpirit.js";
import { darkKnightTick } from "./bosses/darkKnight.js";
import { dragonTick } from "./dragon/dragon.js";

export function initEntityTicks() {
    system.runInterval(() => {
        lavaGolemTick();
        fireSpiritTick();
        darkKnightTick();
        dragonTick();
    }, 5);
}