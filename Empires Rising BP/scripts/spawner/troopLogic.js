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
// Temporarily renames §r Pillagers only for troops (where cancel + re-apply is safe)
world.beforeEvents.entityHurt.subscribe((ev) => {
    const entity = ev.hurtEntity;

    if (entity.hasTag("dying")) return;

    const health = entity.getComponent("minecraft:health");
    if (!health) return;

    if (health.currentValue <= 0) {
        const source = ev.damageSource;
        const damagingEntity = source.damagingEntity;
        const damagingProjectile = source.damagingProjectile;
        const cause = source.cause;

        // ---------- Custom troops only ----------
        if (isTroop(entity.typeId)) {
            ev.cancel = true;

            system.run(() => {
                try {
                    if (!entity.isValid) return;

                    entity.addTag("dying");
                    entity.nameTag = getTroopName(entity.typeId);

                    // Temporarily rename so the death message shows "Pillager"
                    let originalNameTag = null;
                    if (damagingEntity?.isValid && damagingEntity.nameTag === "§r") {
                        originalNameTag = "§r";
                        damagingEntity.nameTag = "Pillager";
                    }

                    let options;
                    if (cause === "projectile" && damagingProjectile?.isValid) {
                        options = { damagingProjectile };
                        if (damagingEntity?.isValid) options.damagingEntity = damagingEntity;
                    } else {
                        options = { cause: cause || "entityAttack" };
                        if (damagingEntity?.isValid) options.damagingEntity = damagingEntity;
                    }

                    entity.applyDamage(99999, options);

                    // Restore
                    if (originalNameTag !== null && damagingEntity?.isValid) {
                        damagingEntity.nameTag = originalNameTag;
                    }
                } catch (e) {
                    console.warn(`Failed to apply lethal damage: ${e}`);
                }
            });
            return;
        }

        // ---------- Players & tamed entities ----------
        // Do NOT cancel – let the original damage kill them.
        // Custom message when the killer is a §r Pillager:
        //   • Player death  → notify EVERY player on the server
        //   • Tamed mob     → notify only the owner
        if (damagingEntity?.isValid && damagingEntity.nameTag === "§r") {
            system.run(() => {
                try {
                    if (!entity.isValid) return;

                    const victimName = entity.nameTag || entity.typeId.split(":")[1] || "Entity";
                    const message = `§c${victimName} was killed by a Pillager`;

                    if (entity.typeId === "minecraft:player") {
                        // Notify every player
                        for (const player of world.getPlayers()) {
                            if (player.isValid) {
                                player.sendMessage(message);
                            }
                        }
                    } else {
                        // Tamed entity → only the owner
                        const tameable = entity.getComponent("minecraft:tameable");
                        if (tameable?.tamedToPlayer?.isValid) {
                            tameable.tamedToPlayer.sendMessage(message);
                        }
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


// Notify owner when they toggle a troop between Follow / Stay (Patrol)
world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
    const player = ev.player;
    const entity = ev.target;

    if (!entity?.isValid || !isTroop(entity.typeId)) return;
    if (!player.isSneaking) return;          // only the sneak-interact switches mode

    // Must be the owner
    const tameable = entity.getComponent("minecraft:tameable");
    if (!tameable?.tamedToPlayer || tameable.tamedToPlayer.id !== player.id) return;

    // mark_variant: 1 = currently Follow → switching to Stay/Patrol
    //               0 = currently Patrol → switching to Follow
    const mark = entity.getComponent("minecraft:mark_variant");
    const current = mark?.value ?? 0;

    const troopName = getTroopName(entity.typeId);

    if (current === 1) {
        player.sendMessage(`§e${troopName} is now on §6Stay / Patrol`);
    } else {
        player.sendMessage(`§e${troopName} is now §aFollowing you`);
    }
});

// Returns a tag such as "faction:fire", "faction:water", or "faction:void".
function getFactionTag(entity) {
    if (!entity?.isValid) return null;

    return entity.getTags().find(tag => tag.startsWith("faction:")) ?? null;
}