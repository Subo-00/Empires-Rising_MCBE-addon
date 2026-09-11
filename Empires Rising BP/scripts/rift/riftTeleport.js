import { system, world } from "@minecraft/server";
import { DIMENSION_ID } from "../config/riftConfig.js";
import { forceNearbyTroopsStay, restoreNearbyTroops } from "../sharedHelpers/troopTeleport.js";
import { getTag } from "../spawner/spawnerHelpers.js";    
import { getNum, setPlayerRiftTags, isBroken } from "./riftHelpers.js";
import { ensureIsland } from "./riftIsland.js";

// playerId → tick until which they cannot be teleported again
export const teleportLock = new Map();

export async function teleportPlayerToRift(player, entity, loc, forcedRiftId = null) {
    const riftId = forcedRiftId ?? (entity ? getNum(entity, "riftId:", 0) : 0);
    if (!riftId) {
        console.warn("[DBG] teleport aborted – no riftId");
        return;
    }

    if (entity && isBroken(entity)) {
        console.warn("[DBG] teleport aborted – port broken");
        return;
    }

    if (player.dimension.id === DIMENSION_ID) {
        console.warn("[DBG] already inside rift dimension – abort");
        return;
    }

    // still respect broken state when we can read the entity
    if (entity && isBroken(entity)) {
        console.warn("[DBG] teleport aborted – port broken");
        return;
    }

    console.warn(`[DBG] START teleport to rift #${riftId}`);

    const islandData = await ensureIsland(riftId);

    setPlayerRiftTags(player, riftId, loc);

    forceNearbyTroopsStay(player);
    await system.waitTicks(5);

    const riftDim = world.getDimension(DIMENSION_ID);
    player.teleport(islandData.spawn, { dimension: riftDim, checkForBlocks: false });

    const fog = entity
        ? getTag(entity, "fog:", "minecraft:fog_hell")
        : "minecraft:fog_hell";
    try {
        player.runCommand("fog @s remove rift_fog");
        player.runCommand(`fog @s push ${fog} rift_fog`);
    } catch { }

    player.sendMessage(`§dYou have entered Rift #${riftId}.`);
}

export async function returnPlayerHome(player, returnLoc) {
    console.warn(`[DBG returnPlayerHome] start for ${player.name}`);

    forceNearbyTroopsStay(player);
    await system.waitTicks(5);

    try {
        player.runCommand("fog @s remove rift_fog");
    } catch { }

    if (!returnLoc) {
        console.warn("[DBG returnPlayerHome] no returnLoc!");
        player.sendMessage("§cNo return location saved!");
        return;
    }

    const targetDim = world.getDimension(
        returnLoc.dim === "overworld" ? "minecraft:overworld" : returnLoc.dim
    );

    const finalLoc = {
        x: returnLoc.x + 0.5,
        y: returnLoc.y + 1,
        z: returnLoc.z + 0.5
    };

    player.teleport(
        { x: returnLoc.x, y: 300, z: returnLoc.z },
        { dimension: targetDim, checkForBlocks: false, keepVelocity: false }
    );
    await system.waitTicks(5);

    player.teleport(finalLoc, {
        dimension: targetDim,
        checkForBlocks: false,
        keepVelocity: false
    });

    restoreNearbyTroops(player);
    player.sendMessage("§aYou have returned from the rift.");
    console.warn(`[DBG returnPlayerHome] finished for ${player.name}`);
}