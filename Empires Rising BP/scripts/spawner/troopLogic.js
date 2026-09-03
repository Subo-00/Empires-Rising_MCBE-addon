import { world, system } from "@minecraft/server";
import { spawnUnit } from "./spawnUnits.js";
import { setTag, getTag, isBarbarian, isArcher, isDragon, isTroop } from "./spawnerHelpers.js";
import { SPAWN_DELAY_TICKS } from "../config/spawnerConfig.js";
import { decrementSpawnerAlive } from "./spawnerLogic.js";

// In-memory guard – prevents multiple concurrent chains for the same spawner
const currentlyProcessing = new Set();

function getTroopName(typeId) {
    if (isBarbarian(typeId)) return "Barbarian";
    if (isArcher(typeId)) return "Archer";
    if (isDragon(typeId)) return "Dragon";
    return "Troop";
}

/**
 * Processes one unit from a spawner's queue, then schedules the next if needed.
 */
export function processSpawnerQueue(spawner) {
    if (!spawner || !spawner.isValid) return;

    const id = getTag(spawner, "id:", "");
    if (!id) return;                       // safety

    // Already being processed by another chain → do nothing
    if (currentlyProcessing.has(id)) return;

    const queue = Number(getTag(spawner, "queue:", 0));
    const alive = Number(getTag(spawner, "alive:", 0));
    const cap = Number(getTag(spawner, "cap:", 1));

    if (queue <= 0 || alive >= cap) {
        currentlyProcessing.delete(id);
        return;
    }

    // Mark as processing
    currentlyProcessing.add(id);

    // Spawn one unit
    spawnUnit(spawner);
    setTag(spawner, "queue:", queue - 1);
    setTag(spawner, "alive:", alive + 1);

    const remaining = queue - 1;
    if (remaining > 0 && (alive + 1) < cap) {
        // Schedule next spawn
        system.runTimeout(() => {
            currentlyProcessing.delete(id);   // allow the next call
            processSpawnerQueue(spawner);
        }, SPAWN_DELAY_TICKS);
    } else {
        // Finished this batch
        currentlyProcessing.delete(id);
    }
}

/**
 * Starts processing for every currently loaded spawner that has a queue.
 * Call once on script load.
 */
export function resumeAllQueuedSpawners() {
    const dims = [
        world.getDimension("overworld"),
        world.getDimension("nether"),
        world.getDimension("the_end")
    ];

    for (const dim of dims) {
        for (const spawner of dim.getEntities({ type: "subo:spawner_entity" })) {
            const queue = Number(getTag(spawner, "queue:", 0));
            if (queue > 0) {
                processSpawnerQueue(spawner);
            }
        }
    }
}

// Resume when a spawner entity is loaded (restart / chunk load)
world.afterEvents.entityLoad.subscribe(ev => {
    const entity = ev.entity;
    if (entity.typeId !== "subo:spawner_entity") return;


    const queue = Number(getTag(entity, "queue:", 0));
    if (queue > 0) {
        system.runTimeout(() => processSpawnerQueue(entity), 5);
    }
});

// On death we must find the owning spawner to decrement "alive".
// If the spawner isn't currently loaded, decrementSpawnerAlive queues the decrement
// (scoreboard-backed, survives restarts) and the periodic cleanup pass in
// spawnerLogic.js applies it once the spawner loads back in.
world.afterEvents.entityDie.subscribe(ev => {
    const entity = ev.deadEntity;
    if (!isTroop(entity.typeId)) return;

    const dimension = entity.dimension;
    const loc = entity.location;

    // Clean up keepOnDeath items
    const items = dimension.getEntities({
        type: "item",
        location: loc,
        maxDistance: 4
    });

    for (const item of items) {
        try {
            if (item.getComponent("minecraft:item")?.itemStack?.keepOnDeath) {
                item.kill();
            }
        } catch { }
    }

    const tag = entity.getTags().find(t => t.startsWith("spawner:"));
    if (!tag) return;

    const id = tag.split(":")[1];
    decrementSpawnerAlive(id, 1);
});


// Handle barbarian "hit" animation
world.afterEvents.entityHitEntity.subscribe(ev => {
    const attacker = ev.damagingEntity;

    if (!attacker || !isBarbarian(attacker.typeId)) return;

    // SET variable to trigger swing
    attacker.setProperty("subo:is_attacking", 1.0);

    system.runTimeout(() => {
        try {
            attacker.setProperty("subo:is_attacking", 0.0);
        }
        catch { }


    }, 4); // ~0.2s
});

const names = {
    "subo:barbarian": "Barbarian",
    "subo:archer": "Archer",
    "subo:dragon": "Dragon"
};

// Give troops their real nameTags before death so they display a proper death message
world.beforeEvents.entityHurt.subscribe((ev) => {
    const entity = ev.hurtEntity;

    if (entity.hasTag("dying")) return;

    const health = entity.getComponent("minecraft:health");
    if (!health) return;

    if (health.currentValue <= 0) {
        const source = ev.damageSource;
        const killer = source.damagingEntity;

        // ---------- Custom troops (subo:) ----------
        if (entity.typeId.startsWith("subo:")) {
            ev.cancel = true;

            system.run(() => {
                try {
                    if (!entity.isValid) return;

                    entity.addTag("dying");
                    entity.nameTag = getTroopName(entity.typeId);   // ← fixed
                    entity.kill();
                } catch (e) { }
            });
            return;
        }

        // ---------- Players & vanilla tamed entities (wolf, etc.) ----------
        // We do NOT cancel damage here – let them die normally
        // If the killer is a Pillager with a §r nameTag we notify the killed player or the killed tamed entity's owner
        if (killer?.isValid && killer.nameTag === "§r") {
            system.run(() => {
                try {
                    // Wait until the entity is actually dead / has the dying state
                    if (!entity.isValid) return;          // already gone

                    let targetPlayer = null;

                    // Case 1: the victim is a player
                    if (entity.typeId === "minecraft:player") {
                        targetPlayer = entity;
                    }
                    // Case 2: tamed wolf (or any other tameable)
                    else {
                        const tameable = entity.getComponent("minecraft:tameable");
                        if (tameable?.tamedToPlayer) {
                            targetPlayer = tameable.tamedToPlayer;
                        }
                    }

                    if (targetPlayer?.isValid) {
                        const victimName = entity.nameTag || entity.typeId.split(":")[1] || "Entity";
                        targetPlayer.sendMessage(`§c${victimName} was killed by a Pillager`);
                    }
                } catch (e) { }
            });
        }
    }
});

// Disable archer friendly fire for entities in the same faction
world.beforeEvents.entityHurt.subscribe(ev => {
    const { damageSource, hurtEntity: target } = ev;
    const attacker = damageSource.damagingEntity;

    if (!attacker || !isArcher(attacker.typeId)) return;

    // Only protect faction players and faction troops
    if (!isTroop(target.typeId) && target.typeId !== "minecraft:player") return;

    const attackerFaction = getFactionTag(attacker);
    const targetFaction = getFactionTag(target);

    // Same faction → cancel damage and remove the fired arrow
    if (attackerFaction && attackerFaction === targetFaction) {
        ev.cancel = true;

        const projectile = damageSource.damagingProjectile;
        if (projectile) {
            system.run(() => {
                try {
                    if (projectile.isValid) {
                        projectile.remove();
                    }
                } catch { }
            });
        }
    }
});

// Returns a tag such as "faction:fire", "faction:water", or "faction:void".
function getFactionTag(entity) {
    if (!entity?.isValid) return null;

    return entity.getTags().find(tag => tag.startsWith("faction:")) ?? null;
}