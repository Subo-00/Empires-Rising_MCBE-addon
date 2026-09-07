import { isBarbarian, isArcher, isDragon, isTroop } from "../spawner/spawnerHelpers.js";

export function getStayFollowEvents(typeId) {
    if (isBarbarian(typeId)) return { stay: "barbarian:stay", follow: "barbarian:follow" };
    if (isArcher(typeId)) return { stay: "archer:stay", follow: "archer:follow" };
    if (isDragon(typeId)) return { stay: "dragon:stay", follow: "dragon:follow" };
    return null;
}

/**
 * Force all currently-following owned troops near the player to stay
 * and mark them so they can be resumed later.
 */
export function forceNearbyTroopsStay(player, radius = 16) {
    const dim = player.dimension;
    const loc = player.location;

    const nearby = dim.getEntities({ location: loc, maxDistance: radius });

    let count = 0;
    for (const ent of nearby) {
        if (!isTroop(ent.typeId)) continue;

        const ownerTag = ent.getTags().find(t => t.startsWith("owner:"));
        if (!ownerTag || ownerTag !== `owner:${player.name}`) continue;

        const mark = ent.getComponent("minecraft:mark_variant");
        if (!mark || mark.value !== 1) continue; // only currently following

        const events = getStayFollowEvents(ent.typeId);
        if (events) {
            try { ent.triggerEvent(events.stay); } catch { }
        }
        try { ent.addTag("subo:resume_follow"); } catch { }

        count++;
    }

    if (count > 0) {
        player.sendMessage(`§7[Debug] Forced ${count} troop(s) to stay`);
    }
}

/**
 * Find any owned troops that were previously forced to stay
 * and put them back into follow mode.
 * Called AFTER the player has arrived at a location.
 */
export function restoreNearbyTroops(player, radius = 16) {
    const dim = player.dimension;
    const loc = player.location;

    const nearby = dim.getEntities({ location: loc, maxDistance: radius });

    for (const ent of nearby) {
        if (!isTroop(ent.typeId)) continue;
        if (!ent.hasTag("subo:resume_follow")) continue;

        const ownerTag = ent.getTags().find(t => t.startsWith("owner:"));
        if (!ownerTag || ownerTag !== `owner:${player.name}`) continue;

        const events = getStayFollowEvents(ent.typeId);
        if (events) {
            try { ent.triggerEvent(events.follow); } catch { }
        }
        try { ent.removeTag("subo:resume_follow"); } catch { }
    }
}