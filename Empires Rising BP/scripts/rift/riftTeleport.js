import { system, world } from "@minecraft/server";
import { RIFT_DIMENSION_ID } from "../config/rift/riftConfig.js";
import { forceNearbyTroopsStay, restoreNearbyTroops } from "../sharedHelpers/troopTeleport.js";
import { getTag } from "../spawner/spawnerHelpers.js";
import { getNum, setPlayerRiftTags, isBroken, playRiftFeedback, clearPlayerRiftTags } from "./riftHelpers.js";
import { ensureIsland } from "./riftIsland.js";
import { despawnSpiritsForPlayer, spawnSpiritsForPlayer } from "./riftSpirits.js";

// playerId → tick until which they cannot be teleported again
export const teleportLock = new Map();

/** Clean fog + tags + spirits after death/respawn or forced exit. */
export function cleanupPlayerRiftState(player) {
    if (!player?.isValid) return;

    // Fog (command path you already use)
    try {
        player.runCommand("fog @s remove rift_fog");
    } catch { }

    // Modern API fallback (works on newer Script API versions)
    try {
        if (player.fogSettings) {
            player.fogSettings.remove("rift_fog");
            // or player.fogSettings.remove(); to clear everything if needed
        }
    } catch { }

    clearPlayerRiftTags(player);
    despawnSpiritsForPlayer(player);

    // Clear teleport lock so they are not blocked after respawn
    teleportLock.delete(player.id);
}

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

    if (player.dimension.id === RIFT_DIMENSION_ID) {
        console.warn("[DBG] already inside rift dimension – abort");
        return;
    }

    // still respect broken state when we can read the entity
    if (entity && isBroken(entity)) {
        console.warn("[DBG] teleport aborted – port broken");
        return;
    }

    console.warn(`[DBG] START teleport to rift #${riftId}`);

    const islandData = await ensureIsland(riftId, entity, player);

    setPlayerRiftTags(player, riftId, loc);

    forceNearbyTroopsStay(player);
    await system.waitTicks(5);

    const riftDim = world.getDimension(RIFT_DIMENSION_ID);
    player.teleport(islandData.spawn, { dimension: riftDim, checkForBlocks: false });

    const fog = entity
        ? getTag(entity, "fog:", "minecraft:fog_hell")
        : "minecraft:fog_hell";
    try {
        player.runCommand("fog @s remove rift_fog");
        player.runCommand(`fog @s push ${fog} rift_fog`);
    } catch { }

    player.sendMessage(`§dYou have entered Rift #${riftId}.`);

    try {
        player.playSound("subo.rift.enter", { volume: 0.8, pitch: 1.0 });
        player.dimension.spawnParticle("subo:rift_enter", {
            x: player.location.x, y: player.location.y + 0.1, z: player.location.z
        });
    } catch { }


    // ── Wait until the spawn chunk is loaded ──
    const spawnPos = islandData.spawn;
    let loaded = false;

    for (let i = 0; i < 200; i++) {          // max ~10 seconds
        try {
            const block = riftDim.getBlock({
                x: Math.floor(spawnPos.x),
                y: Math.floor(spawnPos.y),
                z: Math.floor(spawnPos.z)
            });
            if (block) {
                loaded = true;
                break;
            }
        } catch {
            // LocationInUnloadedChunkError → still waiting
        }
        await system.waitTicks(2);
    }

    if (loaded) {
        spawnSpiritsForPlayer(player);
    } else {
        player.sendMessage("§cChunk took too long to load. Spirits will appear shortly...");
        // Optional fallback: try again a bit later
        system.runTimeout(() => {
            if (player.isValid && player.dimension.id === RIFT_DIMENSION_ID) {
                spawnSpiritsForPlayer(player);
            }
        }, 40);
    }

}

export async function returnPlayerHome(player, returnLoc) {
    console.warn(`[DBG returnPlayerHome] start for ${player.name}`);

    despawnSpiritsForPlayer(player);
    await system.waitTicks(5);

    cleanupPlayerRiftState(player);

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

    // If the port was destroyed while the player was inside (all pouches extracted),
    // play the destroy feedback now that they can see it – no extra area load needed.
    try {
        const portBlock = targetDim.getBlock({ x: returnLoc.x, y: returnLoc.y, z: returnLoc.z });
        if (portBlock?.typeId === "subo:destroyed_rift") {
            playRiftFeedback(targetDim, { x: returnLoc.x, y: returnLoc.y, z: returnLoc.z }, "subo:rift_destroy", "subo.rift.destroy", 1.15, 0.85);
            try {
                targetDim.playSound("random.explode", { x: returnLoc.x, y: returnLoc.y, z: returnLoc.z }, { volume: 1.1, pitch: 0.85 });
                targetDim.playSound("portal.travel", { x: returnLoc.x, y: returnLoc.y, z: returnLoc.z }, { volume: 0.6, pitch: 0.55 });
            } catch { }
        } else {
            // Normal return close feedback
            player.playSound("subo.rift.close", { volume: 0.7, pitch: 1.05 });
            player.dimension.spawnParticle("subo:rift_close", {
                x: player.location.x, y: player.location.y + 0.5, z: player.location.z
            });
        }
    } catch { }

    console.warn(`[DBG returnPlayerHome] finished for ${player.name}`);
}