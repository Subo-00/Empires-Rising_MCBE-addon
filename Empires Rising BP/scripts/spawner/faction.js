import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { FACTION_NAMES, FACTION_COLORS, FACTION_MAP } from "../config/spawnerConfig.js";
import { removeOneItem } from "./spawnerHelpers.js";

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

        // Already in this faction
        if (current === id) {
            player.sendMessage("§cYou are already in this faction!");
            return false;
        }

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
        const faction = FACTION_MAP[id];
        if (faction) {
            player.addTag(`faction:${faction}`);
        }

        player.sendMessage(`${FACTION_COLORS[id]}You joined the ${FACTION_NAMES[id]} faction!`);

        // Feedback (sound + particles)
        const factionName = FACTION_MAP[id]; // "fire" | "water" | "void"
        if (factionName) {
            playFactionJoinFeedback(player, factionName);
        }

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

/** Call this right after the player successfully joins a faction */
export function playFactionJoinFeedback(player, factionName) {
    // factionName should be "fire" | "water" | "void" (lowercase)
    const dim = player.dimension;
    const loc = player.location;

    const configs = {
        fire: {
            sound: "fire.ignite",
            particle: "minecraft:basic_flame_particle",
            extraParticle: "minecraft:lava_particle",
            pitch: 1.0
        },
        water: {
            sound: "bucket.fill_water",
            particle: "minecraft:cauldron_splash_particle",
            extraParticle: "minecraft:water_drip_particle",
            pitch: 1.1
        },
        void: {
            sound: "portal.portal",
            particle: "minecraft:basic_portal_particle",
            extraParticle: "minecraft:endrod",
            pitch: 0.85
        }
    };

    const cfg = configs[factionName] ?? {
        sound: "random.levelup",
        particle: "minecraft:villager_happy",
        extraParticle: "minecraft:endrod",
        pitch: 1.0
    };

    try {
        dim.playSound(cfg.sound, loc, { volume: 1.2, pitch: cfg.pitch });
        // ring of particles around the player
        for (let i = 0; i < 20; i++) {
            const angle = (i / 20) * Math.PI * 2;
            const r = 1.2;
            dim.spawnParticle(cfg.particle, {
                x: loc.x + Math.cos(angle) * r,
                y: loc.y + 0.8 + Math.sin(i) * 0.3,
                z: loc.z + Math.sin(angle) * r
            });
        }
        // a few extra accent particles
        for (let i = 0; i < 8; i++) {
            dim.spawnParticle(cfg.extraParticle, {
                x: loc.x + (Math.random() - 0.5) * 1.5,
                y: loc.y + 1.0 + Math.random() * 0.8,
                z: loc.z + (Math.random() - 0.5) * 1.5
            });
        }
    } catch { }
}