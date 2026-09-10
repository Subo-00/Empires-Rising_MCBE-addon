import { system } from "@minecraft/server";
import { DESTROYED_RIFT_MESSAGES } from "../config/riftConfig";

const destroyedInteractCooldown = new Map(); // playerId → tick

export function handleDestroyedRiftInteract(event) {
    const player = event.player;
    if (!player) return;

    const now = system.currentTick;
    const lockedUntil = destroyedInteractCooldown.get(player.id) ?? 0;
    if (now < lockedUntil) return;

    destroyedInteractCooldown.set(player.id, now + 100); // 5 seconds

    const msg = DESTROYED_RIFT_MESSAGES[Math.floor(Math.random() * DESTROYED_RIFT_MESSAGES.length)];
    player.onScreenDisplay.setActionBar(msg);
}