import { system, ItemStack } from "@minecraft/server";
import { getStorageLocation, setTag, getTag } from "../spawner/spawnerHelpers.js";
import { PURIFIER_ENTITY, MAX_STACK, INPUTS } from "../config/purifierConfig.js";

export function trySetProp(entity, name, value) {
    try {
        if (entity.getProperty(name) !== value) entity.setProperty(name, value);
    } catch { }
}

export function trySetState(block, value) {
    try {
        block.setPermutation(block.permutation.withState("subo:active", value));
    } catch { }
}

export function getNum(entity, prefix, fallback) {
    const v = getTag(entity, prefix, null);
    return v === null ? fallback : Number(v);
}

export function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

export function topOf(loc) {
    return { x: loc.x + 0.5, y: loc.y + 1.0, z: loc.z + 0.5 };
}

export function ensureId(entity) {
    let id = getTag(entity, "id:", null);
    if (!id) {
        id = Math.random().toString(36).substring(2, 10);
        setTag(entity, "id:", id);
    }
    return id;
}

export function isPurifying(entity) {
    return getNum(entity, "remaining:", 0) > 0;
}

export function clearState(entity) {
    const prefixes = ["remaining:", "total:", "bx:", "by:", "bz:", ...INPUTS.map(i => i.key + ":")];
    for (const tag of entity.getTags()) {
        if (prefixes.some(p => tag.startsWith(p))) {
            entity.removeTag(tag);
        }
    }
}

export function getPurifierEntityAt(dim, loc) {
    const ents = dim.getEntities({
        type: PURIFIER_ENTITY,
        location: getStorageLocation({ location: loc }),
        maxDistance: 0.5
    });
    return ents[0];
}

export function dropItems(dim, loc, typeId, count) {
    let left = count;
    while (left > 0) {
        const n = Math.min(MAX_STACK, left);
        dim.spawnItem(new ItemStack(typeId, n), loc);
        left -= n;
    }
}

export function killLinkedUndeadDelayed(dim, entity, delayTicks = 600) {
    const id = getTag(entity, "id:", null);
    if (!id) return;
    system.runTimeout(() => {
        for (const e of dim.getEntities({ tags: ["purifier_undead:" + id] })) {
            e.kill();
        }
    }, delayTicks);
}