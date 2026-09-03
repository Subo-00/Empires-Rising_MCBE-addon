import { world, system, ItemStack } from "@minecraft/server";
import { setTag, getTag } from "../spawner/spawnerHelpers.js";
import {
    PURIFIER_BLOCK,
    EMPTY_SOUL_SPAWN_EVERY, MAX_EMPTY_SOULS_PER_PURIFIER,
    EMPTY_SOUL_MIN_SPAWN_DIST, EMPTY_SOUL_MAX_SPAWN_DIST, Y_SPAWN_OFFSET,
    EMPTY_SOUL_MIN_SPEED, EMPTY_SOUL_MAX_SPEED, EMPTY_SOUL_REACH_DIST,
    EMPTY_SOUL_SPAWN_ANIM_TICKS, VOID_SHARD_DROP_CHANCE, INPUTS
} from "../config/purifierConfig.js";
import {
    trySetProp, getNum, clamp, topOf, ensureId, isPurifying,
    clearState, getPurifierEntityAt, dropItems, killLinkedUndeadDelayed
} from "./purifierHelpers.js";

// Re-exported so processPurifier can schedule spawns on the same cadence
export { EMPTY_SOUL_SPAWN_EVERY };

// =============================================================================
// Empty soul homing driver – only runs while there are active empty souls
// =============================================================================
let emptySoulRunId = null;

export function startEmptySoulTicker() {
    if (emptySoulRunId !== null) return;
    emptySoulRunId = system.runInterval(() => {
        const dim = world.getDimension("minecraft:overworld");
        let souls;
        try { souls = dim.getEntities({ type: "subo:empty_soul" }); }
        catch (e) { return; }

        if (souls.length === 0) {
            stopEmptySoulTicker();
            return;
        }
        for (const s of souls) tickEmptySoul(dim, s);
    }, 1);
}

export function stopEmptySoulTicker() {
    if (emptySoulRunId === null) return;
    system.clearRun(emptySoulRunId);
    emptySoulRunId = null;
}

function tickEmptySoul(dim, soul) {
    if (!soul.isValid) return;
    if (soul.hasTag("es_dead")) return;

    const tx = getTag(soul, "ptx:", null);
    const ty = getTag(soul, "pty:", null);
    const tz = getTag(soul, "ptz:", null);
    if (tx === null) { soul.remove(); return; }

    const bLoc = { x: Number(tx), y: Number(ty), z: Number(tz) };
    const target = { x: bLoc.x + 0.5, y: bLoc.y + 0.9, z: bLoc.z + 0.5 };

    // CHUNK LOADING FIX: null ≠ destroyed
    const block = dim.getBlock(bLoc);
    if (!block) {
        return; // block data not loaded yet, skip tick
    }
    if (block.typeId !== PURIFIER_BLOCK) {
        fadeOutSoul(soul);
        return;
    }

    // Hold still while the spawn animation plays.
    const spawnedAt = getNum(soul, "spawned:", system.currentTick);
    if (system.currentTick - spawnedAt < EMPTY_SOUL_SPAWN_ANIM_TICKS) return;

    trySetProp(soul, "subo:anim_state", "move");

    const p = soul.location;
    const dx = target.x - p.x, dy = target.y - p.y, dz = target.z - p.z;
    const dist = Math.hypot(dx, dy, dz);

    // Trailing dark-energy particles.
    if (system.currentTick % 2 === 0) {
        try {
            const particleId = Math.random() < 0.4
                ? "subo:empty_soul_glow"
                : "subo:empty_soul_dark";
            dim.spawnParticle(particleId, { x: p.x, y: p.y + 0.5, z: p.z });
        } catch { }
    }

    // Reached the purifier -> destroy only if still purifying/active
    if (dist <= EMPTY_SOUL_REACH_DIST) {
        const stillActive = (() => {
            try {
                return block.permutation.getState("subo:active") === true;
            } catch {
                return false;
            }
        })();
        const entity = getPurifierEntityAt(dim, bLoc);
        const stillPurifying = entity && isPurifying(entity);

        if (!stillActive && !stillPurifying) {
            fadeOutSoul(soul);
            return;
        }

        soul.addTag("es_dead");
        trySetProp(soul, "subo:anim_state", "destroy");
        system.runTimeout(() => {
            purifierDestroyedBySoul(dim, bLoc);
            if (soul.isValid) {
                tryDropVoidShard(dim, soul.location);
                soul.remove();
            }
        }, 12);
        return;
    }

    // Slow when far, fast when close.
    const norm = clamp(dist / EMPTY_SOUL_MAX_SPAWN_DIST, 0, 1);
    const speed = EMPTY_SOUL_MIN_SPEED + (1 - norm) * (EMPTY_SOUL_MAX_SPEED - EMPTY_SOUL_MIN_SPEED);
    const step = Math.min(speed, dist);

    try {
        soul.teleport(
            { x: p.x + (dx / dist) * step, y: p.y + (dy / dist) * step, z: p.z + (dz / dist) * step },
            { facingLocation: target }
        );
    } catch { }
}

// One hit / arrow = death (plays the die animation, then removes).
world.afterEvents.entityHurt.subscribe((ev) => {
    const e = ev.hurtEntity;
    if (!e || !e.isValid || e.typeId !== "subo:empty_soul") return;
    if (e.hasTag("es_dead")) return;
    e.addTag("es_dead");
    const dim = e.dimension;
    trySetProp(e, "subo:anim_state", "die");
    try { for (let i = 0; i < 3; i++) dim.spawnParticle("subo:empty_soul_dark", e.location); } catch { }
    try {
        dim.playSound("mob.empty_soul.die", e.location, {
            volume: 0.4, pitch: 1.2
        });
    } catch { }
    system.runTimeout(() => {
        if (e.isValid) {
            tryDropVoidShard(dim, e.location);
            e.remove();
        }
    }, 10);
});

function fadeOutSoul(soul) {
    if (soul.hasTag("es_dead")) return;
    soul.addTag("es_dead");
    trySetProp(soul, "subo:anim_state", "die");
    system.runTimeout(() => {
        if (soul.isValid) {
            tryDropVoidShard(soul.dimension, soul.location);
            soul.remove();
        }
    }, 10);
}

/** 5% chance to drop a void shard at the given location. */
function tryDropVoidShard(dim, loc) {
    if (Math.random() >= VOID_SHARD_DROP_CHANCE) return;
    try {
        dim.spawnItem(new ItemStack("subo:void_shard", 1), loc);
    } catch { }
}

function purifierDestroyedBySoul(dim, loc) {
    const block = dim.getBlock(loc);
    if (block && block.typeId === PURIFIER_BLOCK) {
        try { dim.spawnParticle("subo:purify_particle", topOf(loc)); } catch { }
        dim.playSound("random.explode", loc, {
            volume: 0.5, pitch: 0.6
        });

        dim.playSound("mob.empty_soul.spawn", loc, {
            volume: 1.5, pitch: 0.8
        });

        // Drop partial items before destroying the block
        const entity = getPurifierEntityAt(dim, loc);
        if (entity && isPurifying(entity)) {
            const total = getNum(entity, "total:", 1);
            const remaining = getNum(entity, "remaining:", 0);
            const fraction = clamp((total - remaining) / total, 0, 1);
            const dropAt = topOf(loc);
            for (const inp of INPUTS) {
                const amount = getNum(entity, inp.key + ":", 0);
                if (amount <= 0) continue;
                const purified = Math.floor(amount * fraction);
                const remaining = amount - purified;
                if (purified > 0) dropItems(dim, dropAt, inp.out, purified);
                // unpurified: 50% survival (same as player-break penalty)
                let survived = 0;
                for (let i = 0; i < remaining; i++) if (Math.random() < 0.5) survived++;
                if (survived > 0) dropItems(dim, dropAt, inp.id, survived);
            }
        }

        block.setType("minecraft:air");
    }

    const entity = getPurifierEntityAt(dim, loc);
    if (entity) {
        killLinkedUndeadDelayed(dim, entity, 0);
        killLinkedEmptySoulsDelayed(dim, entity, 0);
        clearState(entity);
        entity.remove();
    }
}

// =============================================================================
// Spawning
// =============================================================================
export function spawnEmptySoul(dim, loc, entity) {
    const id = getTag(entity, "id:", null) ?? ensureId(entity);

    const linked = dim.getEntities({ tags: ["purifier_empty_soul:" + id] });
    if (linked.length >= MAX_EMPTY_SOULS_PER_PURIFIER) return;

    // 3D distance 15-20 blocks, on an upward hemisphere so it's ALWAYS above the purifier.
    const dist = EMPTY_SOUL_MIN_SPAWN_DIST + Math.random() * (EMPTY_SOUL_MAX_SPAWN_DIST - EMPTY_SOUL_MIN_SPAWN_DIST);
    const theta = Math.random() * Math.PI * 2;      // horizontal angle
    const phi = Math.random() * (Math.PI * 0.4);    // 0 = straight up, ~72° max -> stays above
    const horiz = Math.sin(phi) * dist;
    const vert = Math.cos(phi) * dist;              // always positive -> above

    const spawnLoc = {
        x: loc.x + 0.5 + Math.cos(theta) * horiz,
        y: loc.y + Y_SPAWN_OFFSET + vert,
        z: loc.z + 0.5 + Math.sin(theta) * horiz
    };

    try {
        const soul = dim.spawnEntity("subo:empty_soul", spawnLoc);
        soul.addTag("purifier_empty_soul:" + id);
        setTag(soul, "ptx:", loc.x);
        setTag(soul, "pty:", loc.y);
        setTag(soul, "ptz:", loc.z);
        setTag(soul, "spawned:", system.currentTick);
        trySetProp(soul, "subo:anim_state", "spawn");

        // ===== Flash of light at spawn =====
        for (let i = 0; i < 18; i++) {
            dim.spawnParticle("minecraft:dragon_breath_trail", {
                x: spawnLoc.x + (Math.random() - 0.5) * 1.3,
                y: spawnLoc.y + (Math.random() - 0.5) * 1.3,
                z: spawnLoc.z + (Math.random() - 0.5) * 1.3
            });
        }
        startEmptySoulTicker();

    } catch { }
}

export function killLinkedEmptySoulsDelayed(dim, entity, delayTicks = 0) {
    const id = getTag(entity, "id:", null);
    if (!id) return;
    system.runTimeout(() => {
        for (const e of dim.getEntities({ tags: ["purifier_empty_soul:" + id] })) {
            if (e.isValid) {
                e.addTag("es_dead");
                tryDropVoidShard(e.dimension, e.location);
                e.remove();
            }
        }
        // If no empty souls remain anywhere, stop the ticker
        try {
            const remaining = dim.getEntities({ type: "subo:empty_soul" });
            if (remaining.length === 0) stopEmptySoulTicker();
        } catch { }
    }, delayTicks);
}