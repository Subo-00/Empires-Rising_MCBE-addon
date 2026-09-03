import { world, system } from "@minecraft/server";
import { SHORT_PRESS_TICKS, RADIUS } from "../config/itemsConfig.js";

function isTroop(typeId) {
    return typeof typeId === "string" && (
        typeId.startsWith("subo:barbarian_") ||
        typeId.startsWith("subo:archer_") ||
        typeId.startsWith("subo:dragon_")
    );
}

function getEventPrefix(typeId) {
    if (typeId.startsWith("subo:barbarian_")) return "barbarian";
    if (typeId.startsWith("subo:archer_")) return "archer";
    if (typeId.startsWith("subo:dragon_")) return "dragon";
    return null;
}

/**
 * Orders all nearby troops owned by the player to Follow or Stay.
 */
function commandTroops(player, mode) {
    const dim = player.dimension;
    const loc = player.location;
    const ownerName = player.name;

    const troops = dim.getEntities({
        location: loc,
        maxDistance: RADIUS,
        excludeTypes: ["minecraft:player", "minecraft:item"]
    }).filter(e => {
        if (!isTroop(e.typeId)) return false;
        return e.hasTag(`owner:${ownerName}`);
    });

    if (troops.length === 0) {
        player.sendMessage("§7No troops nearby.");
        return;
    }

    const eventSuffix = mode === "follow" ? "follow" : "stay";
    let count = 0;

    for (const troop of troops) {
        const prefix = getEventPrefix(troop.typeId);
        if (!prefix) continue;

        try {
            troop.triggerEvent(`${prefix}:${eventSuffix}`);
            count++;
        } catch (e) { }
    }

    const actionText = mode === "follow" ? "§aFollow" : "§eStay / Patrol";
    player.sendMessage(`§7Trumpet: ${count} troop${count === 1 ? "" : "s"} → ${actionText}`);
}

// Track when a player started using the trumpet
const startUseTick = new Map(); // playerId → system.currentTick

world.afterEvents.itemStartUse.subscribe(ev => {
    const { source: player, itemStack } = ev;
    if (itemStack?.typeId !== "subo:trumpet") return;

    startUseTick.set(player.id, system.currentTick);

    try {
        // Play once and hold the final pose
        player.playAnimation("animation.humanoid.tooting_goat_horn", {
            blendOutTime: 0.15,
            // Stop the looping behaviour by transitioning to a non-looping state
            nextState: "default",
            // Keep the pose while the item is still being used
            stopExpression: "query.main_hand_item_use_duration <= 0"
        });
    } catch (e) { }
});

world.afterEvents.itemStopUse.subscribe(ev => {
    const { source: player, itemStack, useDuration } = ev;
    if (!itemStack || itemStack.typeId !== "subo:trumpet") return;

    const start = startUseTick.get(player.id);
    startUseTick.delete(player.id);
    if (start === undefined) return;

    // Remaining duration (ticks) until complete.
    // Full duration was 30 ticks → held ≈ 30 - remaining.
    const heldTicks = 30 - Math.max(0, useDuration);

    if (heldTicks < SHORT_PRESS_TICKS) {
        // Short press → Follow
        commandTroops(player, "follow");
        player.playSound("horn.call.1", { volume: 1.0, pitch: 1.1 });

        // Ensure visual cooldown overlay
        const cooldownComp = itemStack.getComponent("minecraft:cooldown");
        cooldownComp?.startCooldown(player);
    }
    // Long press is handled by itemCompleteUse
});

world.afterEvents.itemCompleteUse.subscribe(ev => {
    const { source: player, itemStack } = ev;
    if (!itemStack || itemStack.typeId !== "subo:trumpet") return;

    startUseTick.delete(player.id);

    // Full hold → Stay / Patrol
    commandTroops(player, "stay");
    player.playSound("horn.call.2", { volume: 1.0, pitch: 0.9 });

    // Ensure visual cooldown overlay
    const cooldownComp = itemStack.getComponent("minecraft:cooldown");
    cooldownComp?.startCooldown(player);
});