import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const FACTION_NAMES = { 1: "Fire", 2: "Water", 3: "Void" };
const FACTION_COLORS = { 1: "§c", 2: "§9", 3: "§5" };

// Make sure our objectives exists
system.runTimeout(() => {
    try {
        world.scoreboard.addObjective("faction", "Faction");
        world.scoreboard.addObjective("spawners", "Placed Spawners");
    } catch { }
}, 20);

world.afterEvents.itemUse.subscribe((ev) => {
    const player = ev.source;
    const item = ev.itemStack;

    if (!item || item.typeId !== "subo:faction_token") return;

    // Prevent the item from being used for anything else
    // (optional, but clean)
    // Note: itemUse is after-event, so we just handle it

    system.run(() => {
        const form = new ActionFormData()
            .title("§eSwitch Faction")
            .body("§7Choose a new faction.\n§8You must destroy your placed spawners to proceed.")
            .button("§cJoin Fire")
            .button("§9Join Water")
            .button("§5Join Void")
            .button("§7Cancel");

        form.show(player).then((res) => {
            if (res.canceled || res.selection === 3) return;

            const newId = res.selection + 1;
            const success = setPlayerFaction(player, newId);

            if (success) {
                removeOneItem(player, "subo:faction_token");
            }
        });
    });
});

/**
 * Removes exactly 1 of the given item from the player's inventory
 */
function removeOneItem(player, typeId) {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return;

    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && item.typeId === typeId) {
            if (item.amount > 1) {
                item.amount -= 1;
                inv.setItem(i, item);
            } else {
                inv.setItem(i, undefined);
            }
            return;
        }
    }
}

function getPlayerSpawners(player) {
    try {
        const obj = world.scoreboard.getObjective("spawners");
        if (!obj) return 0;
        return obj.getScore(player) ?? 0;
    } catch {
        return 0;
    }
}

function setPlayerSpawners(player, value) {
    try {
        const obj = world.scoreboard.getObjective("spawners");
        if (!obj) return;
        obj.setScore(player, Math.max(0, value));
    } catch { }
}

export function addPlayerSpawners(player, delta = 1) {
    setPlayerSpawners(player, getPlayerSpawners(player) + delta);
}

export function getPlayerFaction(player) {
    try {
        const obj = world.scoreboard.getObjective("faction");
        if (!obj) return 0;
        return obj.getScore(player) ?? 0;   // ← use player directly
    } catch {
        return 0;
    }
}

export function setPlayerFaction(player, id) {
    try {
        const current = getPlayerFaction(player);

        // Only block if the player is already in a faction AND still has spawners
        if (current !== 0 && getPlayerSpawners(player) > 0) {
            player.sendMessage("§cYou must destroy all your spawners before changing the faction!");
            return false;
        }

        const obj = world.scoreboard.getObjective("faction");
        if (!obj) return false;

        obj.setScore(player, id);

        // Remove any previous faction tags
        for (const tag of player.getTags()) {
            if (tag.startsWith("faction:")) {
                player.removeTag(tag);
            }
        }

        // Add the new faction tag
        const factionMap = { 1: "fire", 2: "water", 3: "void" };
        const faction = factionMap[id];
        if (faction) {
            player.addTag(`faction:${faction}`);
        }

        player.sendMessage(`${FACTION_COLORS[id]}You joined the ${FACTION_NAMES[id]} faction!`);
        return true;
    } catch (e) {
        console.warn("setPlayerFaction error:", e);
        return false;
    }
}

export function promptFactionJoin(player) {
    const form = new ActionFormData()
        .title("§eChoose Your Faction")
        .body("§7You must join a faction before spawning troops.")
        .button("§cJoin Fire")
        .button("§9Join Water")
        .button("§5Join Void");

    return form.show(player).then(res => {
        if (res.canceled) return 0;
        const id = res.selection + 1; // 1,2,3
        setPlayerFaction(player, id);
        return id;
    });
}