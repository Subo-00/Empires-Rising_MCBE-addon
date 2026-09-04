import { system, world, ItemStack } from "@minecraft/server";
import { fireBlaster } from "../items/potionBlaster.js";
import {
    RIDER_FIREBALL_COOLDOWN_TICKS, RIDER_BITE_COOLDOWN_TICKS,
    RIDER_BITE_AOE_RANGE, RIDER_BITE_MAX_TARGETS, RIDER_FIREBALL_REACH,
    BITE_COOLDOWN_TICKS, SPIT_COOLDOWN_TICKS, BITE_RANGE, SPIT_RANGE,
    FOLLOW_LEASH, MAX_HSPEED, MAX_VSPEED, MAX_IMPULSE,
    COMBAT_FLY_HEIGHT, COMBAT_FLY_RADIUS, COMBAT_LAND_DELAY,
    scaleCooldown
} from "../config/entities/dragonConfig.js";
import {
    distSq3D, clamp, hasLineOfSight
} from "./entityHelpers.js";

// ─── State Maps (keyed by dragon.id or player.id) ─────────────────────────
const biteCooldown = new Map();          // AI bite ready-at tick
const spitCooldown = new Map();          // AI fireball ready-at tick
const dragonWasRidden = new Map();       // previous-tick rider presence (for dismount detect)
const riderFireballCooldown = new Map(); // player.id → next allowed fireball tick
const riderBiteCooldown = new Map();     // player.id → next allowed bite tick
const dragonMode = new Map();            // "follow" | "patrol"
const dismountedInAir = new Map();       // dragonId → playerId (shadow-fall mode)
const dragonRider = new Map();           // dragonId → playerId (last known rider)
const combatFlyUntil = new Map();   // dragonId → tick when we should land

// ─── Level / Cooldown Helpers ─────────────────────────────────────────────

/** Read level tag written by spawnUnits.js (defaults to 1). */
function getDragonLevel(dragon) {
    if (!dragon?.isValid) return 1;
    const tag = dragon.getTags().find(t => t.startsWith("level:"));
    return tag ? Math.max(1, Number(tag.slice(6)) || 1) : 1;
}

function getBiteCooldown(dragon) {
    return scaleCooldown(BITE_COOLDOWN_TICKS, getDragonLevel(dragon));
}
function getSpitCooldown(dragon) {
    return scaleCooldown(SPIT_COOLDOWN_TICKS, getDragonLevel(dragon));
}
function getRiderBiteCooldown(dragon) {
    return scaleCooldown(RIDER_BITE_COOLDOWN_TICKS, getDragonLevel(dragon));
}
function getRiderFireballCooldown(dragon) {
    return scaleCooldown(RIDER_FIREBALL_COOLDOWN_TICKS, getDragonLevel(dragon));
}

// ─── Math / Utility Helpers ───────────────────────────────────────────────

function forceGroundedVelocity(dragon) {
    if (!dragon?.isValid) return;
    let mod = 1;

    // Do not kill upward velocity while the dragon is in water
    // (needed so it can jump out onto land)
    try {
        const block = dragon.dimension.getBlock({
            x: Math.floor(dragon.location.x),
            y: Math.floor(dragon.location.y),
            z: Math.floor(dragon.location.z)
        });
        if (block?.isLiquid) mod = -1;          // ← allow jumping out of water
    } catch { }

    const v = dragon.getVelocity();
    if (v.y > 0.02 || Math.abs(v.y) > 0.4) {
        dragon.applyImpulse({
            x: -v.x * 0.3,
            y: (-v.y - 0.15) * mod,
            z: -v.z * 0.3
        });
    }
}

/** Smoothly push velocity toward a desired value without overshooting. */
function applyImpulseTowardVelocity(dragon, desiredVel, maxImpulse) {
    const v = dragon.getVelocity();
    dragon.applyImpulse({
        x: clamp(desiredVel.x - v.x, -maxImpulse, maxImpulse),
        y: clamp(desiredVel.y - v.y, -maxImpulse, maxImpulse),
        z: clamp(desiredVel.z - v.z, -maxImpulse, maxImpulse)
    });
}

/** Owner name from "owner:Name" tag. */
function getOwnerName(dragon) {
    const tag = dragon.getTags().find(t => t.startsWith("owner:"));
    return tag ? tag.slice(6) : null;
}

function getOwnerPlayer(dragon) {
    const name = getOwnerName(dragon);
    return name ? world.getAllPlayers().find(p => p.name === name) : null;
}

function isDragon(typeId) {
    if (typeId === "subo:dragon_fireball") return false;
    return typeof typeId === "string" && typeId.startsWith("subo:dragon_");
}

function getFactionTag(entity) {
    if (!entity?.isValid) return null;

    return entity.getTags().find(tag => tag.startsWith("faction:")) ?? null;
}

function isSameFaction(a, b) {
    const factionA = getFactionTag(a);
    const factionB = getFactionTag(b);

    // Untagged entities are never considered allies.
    return !!factionA && factionA === factionB;
}

/**
 * Valid combat target?
 * - never self
 * - never same-faction troops or players
 * - never the dragon's owner
 * - never creative / spectator players
 * - targets monsters, enemy troops, and enemy-faction players
 */
function isValidTarget(entity, dragon) {
    if (!entity?.isValid || entity.id === dragon.id) return false;

    // Fire, water, and void troops/players do not attack their own faction.
    if (isSameFaction(entity, dragon)) return false;

    if (entity.typeId === "minecraft:player") {
        const ownerName = getOwnerName(dragon);

        if (ownerName && entity.name === ownerName) return false;

        const mode = entity.getGameMode?.();
        return mode !== "creative" && mode !== "spectator";
    }

    const typeFamily = entity.getComponent("minecraft:type_family");

    // Attack monsters and troops from another faction.
    return (
        typeFamily?.hasTypeFamily("monster") ||
        typeFamily?.hasTypeFamily("subo_troop")
    ) ?? false;
}

/** Closest valid target that the dragon can currently see. */
function getNearestVisibleTarget(dragon, maxDistance) {
    const candidates = dragon.dimension.getEntities({
        location: dragon.location,
        maxDistance
    });

    let nearest = null;
    let bestDistSq = Infinity;

    for (const e of candidates) {
        if (!isValidTarget(e, dragon)) continue;
        const dSq = distSq3D(dragon.location, e.location);
        if (dSq < bestDistSq && hasLineOfSight(dragon, e)) {
            bestDistSq = dSq;
            nearest = e;
        }
    }
    return nearest;
}

// ─── Rider Tracking ───────────────────────────────────────────────────────

function setDragonRider(dragonId, player) {
    if (player) dragonRider.set(dragonId, player.id);
    else dragonRider.delete(dragonId);
}

function getDragonRider(dragon) {
    const pid = dragonRider.get(dragon.id);
    return pid ? world.getAllPlayers().find(p => p.id === pid) ?? null : null;
}

/** Clean all per-dragon maps when the dragon dies. */
function clearDragonData(dragonId) {
    [biteCooldown, spitCooldown, dragonWasRidden, dragonMode, dismountedInAir, dragonRider, combatFlyUntil]
        .forEach(m => m.delete(dragonId));
}

// ─── Item & Attack Helpers ────────────────────────────────────────────────

/** Give the special "dragon_attack" item used to trigger rider attacks. */
function giveDragonAttackItem(player) {
    player.getComponent("minecraft:inventory").container.addItem(new ItemStack("subo:dragon_attack", 1));
}

/** Remove the special attack item on dismount. */
function removeDragonAttackItem(player) {
    const container = player.getComponent("minecraft:inventory").container;
    for (let i = 0; i < container.size; i++) {
        if (container.getItem(i)?.typeId === "subo:dragon_attack") {
            container.setItem(i, undefined);
            break;
        }
    }
}

/** Small AOE explosion when a fireball hits something. Skips the dragon's faction. */
function spawnFireballExplosion(dimension, location, factionTag) {
    try {
        dimension.spawnParticle("minecraft:large_explosion", location);
    } catch { }

    try {
        dimension.getEntities({ location, maxDistance: 4 }).forEach(entity => {
            if (!entity?.isValid) return;
            if (entity.typeId === "subo:dragon_fireball") return;

            // Fire/water/void allies are immune to this dragon's fireball.
            const entityFaction = getFactionTag(entity);

            if (factionTag && entityFaction === factionTag) return;

            entity.applyDamage(15, { cause: "entityExplosion" });
        });
    } catch { }
}

/** Spawn a fireball from the dragon's mouth aimed at tLoc. */
function shootFireballAt(dragon, tLoc) {
    facePosition(dragon, tLoc);

    const loc = dragon.location;
    const yaw = dragon.getRotation().y * (Math.PI / 180);

    const spawnPos = {
        x: loc.x - Math.sin(yaw) * 1.4,
        y: loc.y + 1.5,
        z: loc.z + Math.cos(yaw) * 1.4
    };

    try {
        const dir = {
            x: tLoc.x - spawnPos.x,
            y: tLoc.y - spawnPos.y,
            z: tLoc.z - spawnPos.z
        };
        const len = Math.max(0.001, Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2));

        const fb = dragon.dimension.spawnEntity("subo:dragon_fireball", spawnPos);

        // Tag the fireball with the dragon's faction so the explosion can ignore allies.
        const factionTag = getFactionTag(dragon);

        if (factionTag) {
            fb.addTag(factionTag);
        }

        const proj = fb.getComponent("minecraft:projectile");
        proj.owner = dragon;

        // Small forward-arc lift — only meaningful for roughly horizontal shots.
        // Scale it by how horizontal the shot is (0 = straight up/down, 1 = level)
        // so steep vertical shots aren't bent off course, then re-normalize so every
        // shot leaves at the same speed regardless of angle.
        const horizontalDist = Math.sqrt(dir.x ** 2 + dir.z ** 2);
        const horizontalFrac = horizontalDist / len;

        const aim = {
            x: dir.x / len,
            y: dir.y / len + 0.02 * horizontalFrac,
            z: dir.z / len
        };
        const aimLen = Math.sqrt(aim.x ** 2 + aim.y ** 2 + aim.z ** 2) || 1;

        proj.shoot({ x: aim.x / aimLen, y: aim.y / aimLen, z: aim.z / aimLen });
    } catch (e) {
        console.warn(`Fireball error: ${e}`);
    }
}

/** Instantly face a world position (yaw only). */
function facePosition(dragon, pos) {
    const dx = pos.x - dragon.location.x;
    const dz = pos.z - dragon.location.z;
    try {
        dragon.setRotation({ x: 0, y: Math.atan2(-dx, dz) * (180 / Math.PI) });
    } catch { }
}

/** True if any solid block is directly under the dragon (3×3 check). */
function isNearGround(dragon) {
    const loc = dragon.location;
    try {
        const y = Math.floor(loc.y);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                const block = dragon.dimension.getBlock({
                    x: Math.floor(loc.x) + dx, y: y - 1, z: Math.floor(loc.z) + dz
                });
                if (block && !block.isAir && !block.isLiquid) return true;
            }
        }
    } catch { }
    return false;
}

/**
 * Raycast from the rider's eyes to find where the fireball should land.
 * Prefers the nearest entity or block along the view direction.
 */
function raycastTarget(player, dragon) {
    const eye = player.getHeadLocation();
    const dir = player.getViewDirection();
    const maxDist = RIDER_FIREBALL_REACH;

    const blockHit = player.dimension.getBlockFromRay(eye, dir, { maxDistance: maxDist });
    const entityHits = player.dimension.getEntitiesFromRay(eye, dir, { maxDistance: maxDist });

    let bestDistSq = maxDist * maxDist;
    for (const hit of entityHits) {
        const e = hit.entity;
        if (
            !e?.isValid ||
            isDragon(e.typeId) ||
            e.typeId === "subo:dragon_fireball" ||
            e.id === player.id ||
            isSameFaction(e, dragon)
        ) continue;
        const dSq = distSq3D(eye, hit.location ?? e.location);
        if (dSq < bestDistSq) bestDistSq = dSq;
    }

    const blockDistSq = blockHit ? distSq3D(eye, blockHit.block.location) : Infinity;
    const targetDistSq = Math.min(bestDistSq, blockDistSq);
    const t = targetDistSq < Infinity ? Math.sqrt(targetDistSq) : maxDist;

    return {
        x: eye.x + dir.x * t,
        y: eye.y + dir.y * t,
        z: eye.z + dir.z * t
    };
}

// ─── Rider Attacks ────────────────────────────────────────────────────────

/** Forward-facing AOE bite (up to RIDER_BITE_MAX_TARGETS). */
function riderBiteAttack(dragon, player, now) {
    const loc = dragon.location;
    const yaw = dragon.getRotation().y * Math.PI / 180;
    const fwdX = -Math.sin(yaw), fwdZ = Math.cos(yaw);

    const targets = dragon.dimension.getEntities({ location: loc, maxDistance: RIDER_BITE_AOE_RANGE })
        .filter(e => e?.isValid && e.id !== player.id && isValidTarget(e, dragon))
        .filter(e => { // must be roughly in front of the dragon
            const dx = e.location.x - loc.x;
            const dz = e.location.z - loc.z;
            const len = Math.sqrt(dx * dx + dz * dz) || 1;
            return (dx / len) * fwdX + (dz / len) * fwdZ > 0.3;
        })
        .sort((a, b) => distSq3D(loc, a.location) - distSq3D(loc, b.location))
        .slice(0, RIDER_BITE_MAX_TARGETS);
    targets.forEach(t => t.applyDamage(50, { cause: "entityAttack", damagingEntity: dragon }));

    if (targets.length > 0) {
        riderBiteCooldown.set(player.id, now + getRiderBiteCooldown(dragon));
        dragon.triggerEvent("dragon:on_bite");
    }
}

/** Aim + shoot a fireball from the dragon while ridden. */
function riderShootFireball(dragon, player) {
    const targetPos = raycastTarget(player, dragon);

    shootFireballAt(dragon, targetPos);
    dragon.triggerEvent("dragon:on_spit");
}

// ─── Events ───────────────────────────────────────────────────────────────

// Clean maps when a dragon dies
world.afterEvents.entityDie.subscribe(e => {
    if (isDragon(e.deadEntity.typeId)) {
        clearDragonData(e.deadEntity.id);
    }
});

// Owner right-clicks dragon → mount + give attack item
world.beforeEvents.playerInteractWithEntity.subscribe(ev => {
    const { player, target: dragon } = ev;
    if (!dragon || !isDragon(dragon.typeId) || player.isSneaking) return;

    const ownerTag = dragon.getTags().find(t => t.startsWith("owner:"));
    if (!ownerTag || player.name !== ownerTag.slice(6)) return;

    const equippable = player.getComponent("minecraft:equippable");
    const mainhand = equippable?.getEquipment("Mainhand");

    if (mainhand?.typeId === "subo:potion_blaster") {
        ev.cancel = true; // stop the mount from happening at all
        system.run(() => fireBlaster(player, mainhand)); // fire it manually since onUse won't trigger here
        return;
    }

    system.runTimeout(() => {
        if (!dragon.isValid || !player.isValid) return;
        dragon.getComponent("minecraft:rideable")?.addRider(player);
        giveDragonAttackItem(player);
        setDragonRider(dragon.id, player);
        dragon.triggerEvent("dragon:start_flying");
        dismountedInAir.delete(dragon.id);
    }, 2);
});

// Use the special item while riding → fireball (preferred) or bite
world.afterEvents.itemUse.subscribe(ev => {
    if (ev.itemStack?.typeId !== "subo:dragon_attack") return;
    const player = ev.source;
    const dragon = player.getComponent("minecraft:riding")?.entityRidingOn;
    if (!dragon || !dragon.isValid || !isDragon(dragon.typeId)) return;

    const now = system.currentTick;
    const pid = player.id;

    // Prefer fireball; fall back to bite if fireball is on cooldown
    if (now >= (riderFireballCooldown.get(pid) ?? 0)) {
        riderFireballCooldown.set(pid, now + getRiderFireballCooldown(dragon));
        riderShootFireball(dragon, player);
    } else if (now >= (riderBiteCooldown.get(pid) ?? 0)) {
        riderBiteAttack(dragon, player, now);
    }
});

function detonateDragonFireball(projectile, dimension, location) {
    let factionTag = getFactionTag(projectile);
    let shouldExplode = true;

    if (!factionTag) {
        // No faction on the fireball itself → infer it from nearby players.
        const nearbyPlayers = dimension.getEntities({
            location,
            maxDistance: 6,
            type: "minecraft:player"
        });

        const nearbyFactions = new Set(
            nearbyPlayers.map(p => getFactionTag(p)).filter(Boolean)
        );

        if (nearbyFactions.size === 1) {
            // Only one player, or multiple players that all share the same faction.
            factionTag = [...nearbyFactions][0];
        } else {
            // Players from more than one faction nearby → skip the explosion entirely.
            shouldExplode = false;
        }
    }

    if (shouldExplode) {
        spawnFireballExplosion(dimension, location, factionTag);
    }

    try {
        if (projectile.isValid) {
            projectile.remove();
        }
    } catch { }
}

// Fireball impact on an entity
world.afterEvents.projectileHitEntity.subscribe(ev => {
    const projectile = ev.projectile;

    if (projectile.typeId !== "subo:dragon_fireball") return;

    detonateDragonFireball(projectile, ev.dimension, ev.location);
});

// Fireball impact on a block
world.afterEvents.projectileHitBlock.subscribe(ev => {
    const projectile = ev.projectile;

    if (projectile.typeId !== "subo:dragon_fireball") return;

    detonateDragonFireball(projectile, ev.dimension, ev.location);
});

// ─── Main Tick (called every 5 ticks from main.js) ────────────────────────
export function dragonTick() {
    const now = system.currentTick;
    // NOTE: currently only Overworld dragons are processed
    const dragons = world.getDimension("overworld")
        .getEntities()
        .filter(entity => isDragon(entity.typeId));

    for (const dragon of dragons) {
        if (!dragon.isValid) continue;
        const id = dragon.id;

        // Current rider from the rideable component (most reliable source)
        const rideable = dragon.getComponent("minecraft:rideable");
        const currentRiders = rideable?.getRiders?.() ?? [];
        const currentRider = currentRiders[0] ?? null;

        if (currentRider) setDragonRider(id, currentRider);

        // Cache follow/patrol mode from entity property
        const isPatrolling = dragon.getProperty("subo:is_patrolling") === true;
        dragonMode.set(id, isPatrolling ? "patrol" : "follow");

        // ── Dismount Detection ────────────────────────────────────────
        const hadRider = dragonWasRidden.get(id) ?? false;
        if (hadRider && !currentRider) {
            const dismountPlayer = getDragonRider(dragon);
            if (dismountPlayer) {
                removeDragonAttackItem(dismountPlayer);
                riderFireballCooldown.delete(dismountPlayer.id);
                riderBiteCooldown.delete(dismountPlayer.id);

                // If we were flying, enter "shadow fall" so dragon follows the player down
                if (dragon.getProperty("subo:is_flying")) {
                    dismountedInAir.set(id, dismountPlayer.id);
                }
            }
            dragon.triggerEvent("dragon:on_dismount");
            setDragonRider(id, null);
            combatFlyUntil.delete(id);
        }
        dragonWasRidden.set(id, !!currentRider);

        // ── Shadow Fall (dismounted while airborne) ───────────────────
        // Dragon mirrors the falling player until both are near ground.
        const shadowId = dismountedInAir.get(id);
        if (!currentRider && shadowId) {
            try {
                const shadowPlayer = world.getAllPlayers().find(p => p.id === shadowId);
                if (!shadowPlayer?.isValid) {
                    dismountedInAir.delete(id);
                    if (dragon.getProperty("subo:is_flying")) dragon.triggerEvent("dragon:stop_flying");
                } else {
                    const pVel = shadowPlayer.getVelocity();
                    const pLoc = shadowPlayer.location;
                    const dLoc = dragon.location;

                    // Soft teleport if more than 2 blocks away (reduces jitter)
                    if (distSq3D(dLoc, pLoc) > 4) {
                        dragon.teleport(
                            { x: pLoc.x, y: pLoc.y, z: pLoc.z },
                            { dimension: dragon.dimension, keepVelocity: false }
                        );
                        dragon.applyImpulse({ x: 0, y: -1, z: 0 });
                    }

                    // Match player's vertical velocity
                    dragon.applyImpulse({ x: 0, y: -Math.abs(pVel.y), z: 0 });
                    dragon.setRotation({ x: 0, y: shadowPlayer.getRotation().y });

                    // Exit when dragon or player has landed
                    const playerLanded = Math.abs(pVel.y) < 0.15 && isNearGround(shadowPlayer);
                    if (isNearGround(dragon) || playerLanded) {
                        dismountedInAir.delete(id);
                        if (dragon.getProperty("subo:is_flying")) dragon.triggerEvent("dragon:stop_flying");
                    }
                    continue; // skip normal AI while in shadow mode
                }
            } catch (e) {
                console.warn(`Shadow mode error: ${e}`);
                dismountedInAir.delete(id);
            }
        }

        // True while this (unmounted) dragon is actively doing patrol-mode combat flight.
        const inCombatFlight = !currentRider && (combatFlyUntil.get(id) ?? 0) > now;

        // Force grounded state when unmounted, not shadow-falling, and not mid combat-flight
        if (!currentRider && !dismountedInAir.has(id) && !inCombatFlight && dragon.getProperty("subo:is_flying")) {
            dragon.triggerEvent("dragon:stop_flying");
        }

        const near_ground = isNearGround(dragon);
        const vel = dragon.getVelocity();
        const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

        const isFlyingProp = dragon.getProperty("subo:is_flying") === true;
        if (!currentRider && !dismountedInAir.has(id) && !inCombatFlight && !isFlyingProp) {
            forceGroundedVelocity(dragon);
            if (!isNearGround(dragon) && horizontalSpeed < 0.15 && Math.abs(vel.y) < 0.1) {
                dragon.triggerEvent("dragon:stop_flying");
            }
        }

        // Safety: stop flying if almost stationary near ground (skip mid combat-flight)
        if (!inCombatFlight && dragon.getProperty("subo:is_flying") && near_ground && horizontalSpeed < 0.4) {
            dragon.triggerEvent("dragon:stop_flying");
            system.runTimeout(() => {
                if (dragon.isValid) {
                    const v = dragon.getVelocity();
                    dragon.applyImpulse({ x: -v.x, y: -v.y - 0.3, z: -v.z });
                }
            }, 1);
        }

        // ── Ridden Flight Control ─────────────────────────────────────
        if (currentRider) {
            const isFlying = dragon.getProperty("subo:is_flying");
            if (!isFlying && !near_ground) {
                dragon.triggerEvent("dragon:start_flying");
            }

            // Match rider look direction
            const rot = currentRider.getRotation();
            dragon.setRotation({ x: 0, y: rot.y });

            // Convert movement input → world-space velocity
            const move = currentRider.inputInfo?.getMovementVector?.() ?? { x: 0, y: 0 };
            const jump = currentRider.isJumping;
            const mag = Math.hypot(move.x, move.y) || 1;
            const forward = move.y / mag, strafe = move.x / mag;
            const yawRad = rot.y * Math.PI / 180;

            let vx = (-Math.sin(yawRad) * forward + Math.cos(yawRad) * strafe) * MAX_HSPEED;
            let vz = (Math.cos(yawRad) * forward + Math.sin(yawRad) * strafe) * MAX_HSPEED;
            let vy = jump ? MAX_VSPEED : 0;

            if (near_ground) {
                applyImpulseTowardVelocity(dragon, { x: vx, y: vy, z: vz }, MAX_IMPULSE);
                if (jump) dragon.applyImpulse({ x: 0, y: 0.5, z: 0 }); // extra takeoff boost
            } else {
                applyImpulseTowardVelocity(dragon, { x: vx, y: vy, z: vz }, MAX_IMPULSE);
            }

            continue; // ridden dragons skip AI
        }

        // ── Unridden AI ───────────────────────────────────────────────
        const attackState = dragon.getProperty("subo:attack_state");
        const flying = dragon.getProperty("subo:is_flying");

        if (dragonMode.get(id) === "follow") {
            // Follow mode never flies, so it's safe to fully pause during its short attack animation.
            if (attackState !== 0) continue;
            tickFollowMode(dragon, id, now, flying);
        } else {
            // Patrol mode must keep steering every tick, even mid-bite/mid-spit,
            // or the dragon coasts on stale velocity and visibly sinks while attacking.
            tickPatrolMode(dragon, id, now, flying, attackState);
        }
    }
}

// ─── AI Modes ─────────────────────────────────────────────────────────────

/** Follow mode – NEVER flies, stays grounded, attacks on the ground */
function tickFollowMode(dragon, id, now, isFlying) {
    // Force land if somehow still flying
    if (isFlying) {
        dragon.triggerEvent("dragon:stop_flying");
        combatFlyUntil.delete(id);
        return;
    }

    const owner = getOwnerPlayer(dragon);
    if (owner && distSq3D(dragon.location, owner.location) > FOLLOW_LEASH * FOLLOW_LEASH) return;

    const target = getNearestVisibleTarget(dragon, SPIT_RANGE);
    if (!target) return;

    facePosition(dragon, target.location);
    const distSq = distSq3D(dragon.location, target.location);

    if (distSq <= BITE_RANGE * BITE_RANGE && now >= (biteCooldown.get(id) ?? 0)) {
        target.applyDamage(50, { cause: "entityAttack", damagingEntity: dragon });
        dragon.triggerEvent("dragon:on_bite");
        biteCooldown.set(id, now + getBiteCooldown(dragon));
    } else if (distSq <= SPIT_RANGE * SPIT_RANGE && now >= (spitCooldown.get(id) ?? 0)) {
        fireSpitVolley(dragon, id, now, target);
    }
}

/** Patrol mode – flies above / around targets, lands after 2 s idle */
function tickPatrolMode(dragon, id, now, isFlying, attackState) {
    const target = getNearestVisibleTarget(dragon, SPIT_RANGE);

    if (target) {
        combatFlyUntil.set(id, now + COMBAT_LAND_DELAY);
        doCombatFlight(dragon, id, now, target, isFlying, attackState);
    } else if (attackState === 0 && isFlying && now >= (combatFlyUntil.get(id) ?? 0)) {
        dragon.triggerEvent("dragon:stop_flying");
        dragon.triggerEvent("dragon:exit_combat");
        combatFlyUntil.delete(id);
    }
}

/** Shared combat-flight logic (only called from patrol) */
function doCombatFlight(dragon, id, now, target, isFlying, attackState) {
    dragon.triggerEvent("dragon:enter_combat"); // idempotent, safe every call

    if (!isFlying) {
        dragon.triggerEvent("dragon:start_flying");
        return;
    }

    const tLoc = target.location;
    const dLoc = dragon.location;

    // Orbit above the target — runs every tick, including mid bite/spit,
    // so the dragon keeps hovering instead of drifting on stale velocity.
    const angle = (now * 0.04) % (Math.PI * 2);
    const desired = {
        x: tLoc.x + Math.cos(angle) * COMBAT_FLY_RADIUS,
        y: tLoc.y + COMBAT_FLY_HEIGHT,
        z: tLoc.z + Math.sin(angle) * COMBAT_FLY_RADIUS
    };

    const dir = {
        x: desired.x - dLoc.x,
        y: desired.y - dLoc.y,
        z: desired.z - dLoc.z
    };
    const len = Math.sqrt(dir.x ** 2 + dir.y ** 2 + dir.z ** 2) || 1;
    const speed = 0.45;

    applyImpulseTowardVelocity(dragon, {
        x: (dir.x / len) * speed,
        y: (dir.y / len) * speed * 0.7,
        z: (dir.z / len) * speed
    }, 0.35);

    facePosition(dragon, tLoc);

    // Don't start a new bite/spit while one is already playing —
    // but steering above still ran unconditionally.
    if (attackState !== 0) return;

    const distSq = distSq3D(dLoc, tLoc);
    if (distSq <= BITE_RANGE * BITE_RANGE && now >= (biteCooldown.get(id) ?? 0)) {
        target.applyDamage(50, { cause: "entityAttack", damagingEntity: dragon });
        dragon.triggerEvent("dragon:on_bite");
        biteCooldown.set(id, now + getBiteCooldown(dragon));
    } else if (distSq <= SPIT_RANGE * SPIT_RANGE && now >= (spitCooldown.get(id) ?? 0)) {
        fireSpitVolley(dragon, id, now, target);
    }
}

/** Trigger spit animation and launch one fireball after a short delay. */
function fireSpitVolley(dragon, id, now, target) {
    if (!dragon?.isValid) return;

    dragon.triggerEvent("dragon:on_spit");
    spitCooldown.set(id, now + getSpitCooldown(dragon));

    system.runTimeout(() => {
        if (dragon.isValid && target.isValid) {
            facePosition(dragon, target.location);
            shootFireballAt(dragon, target.location);
        }
    }, 1);
}