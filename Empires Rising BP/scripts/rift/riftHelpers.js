import { getStorageLocation, setTag, getTag } from "../spawner/spawnerHelpers.js";
import { RIFT_ENTITY } from "../config/rift/riftConfig.js";

export function trySetState(block, value) {
  try {
    block.setPermutation(block.permutation.withState("subo:state", value));
  } catch { }
}

export function getNum(entity, prefix, fallback = 0) {
  if (!entity || !entity.isValid) return fallback;
  try {
    const v = getTag(entity, prefix, null);
    return v === null ? fallback : Number(v);
  } catch {
    return fallback;
  }
}

export function setNum(entity, prefix, value) {
  if (!entity || !entity.isValid) return;
  try {
    setTag(entity, prefix, value);
  } catch { }
}

export function ensureId(entity) {
  if (!entity || !entity.isValid) return null;
  let id = getTag(entity, "id:", null);
  if (!id) {
    id = Math.random().toString(36).substring(2, 10);
    setTag(entity, "id:", id);
  }
  return id;
}

export function getRiftEntityAt(dim, loc) {
  try {
    const ents = dim.getEntities({
      type: RIFT_ENTITY,
      location: getStorageLocation({ location: loc, dimension: dim }),
      maxDistance: 0.5
    });
    return ents[0] ?? null;
  } catch {
    return null;
  }
}

export function isBroken(entity) {
  if (!entity || !entity.isValid) return true;
  try {
    return getTag(entity, "broken:", null) === "1";
  } catch {
    return true;
  }
}

export function isActive(entity) {
  if (!entity || !entity.isValid) return false;
  return getNum(entity, "remaining:", 0) > 0;
}

export function clearRiftState(entity) {
  if (!entity || !entity.isValid) return;
  const prefixes = [
    "remaining:", "total:", "riftId:", "bx:", "by:", "bz:",
    "pouchTotal:", "pouchOpened:", "fog:", "returnX:", "returnY:", "returnZ:"
  ];
  try {
    for (const tag of [...entity.getTags()]) {
      if (prefixes.some(p => tag.startsWith(p))) entity.removeTag(tag);
    }
  } catch { }
}

export function blockLoc(entity) {
  if (!entity || !entity.isValid) return null;
  try {
    const x = getTag(entity, "bx:", null);
    const y = getTag(entity, "by:", null);
    const z = getTag(entity, "bz:", null);
    if (x === null || y === null || z === null) return null;
    return { x: Number(x), y: Number(y), z: Number(z) };
  } catch {
    return null;
  }
}

// ----- Player rift tags -----
export function clearPlayerRiftTags(player) {
  if (!player || !player.isValid) return;
  const prefixes = ["riftId:", "riftReturnX:", "riftReturnY:", "riftReturnZ:", "riftDim:"];
  try {
    for (const tag of [...player.getTags()]) {
      if (prefixes.some(p => tag.startsWith(p))) player.removeTag(tag);
    }
  } catch { }
}

export function setPlayerRiftTags(player, riftId, loc) {
  if (!player || !player.isValid) return;
  clearPlayerRiftTags(player);
  setTag(player, "riftId:", riftId);
  setTag(player, "riftReturnX:", loc.x);
  setTag(player, "riftReturnY:", loc.y);
  setTag(player, "riftReturnZ:", loc.z);
  setTag(player, "riftDim:", "minecraft:overworld");
}

export function getPlayerRiftReturn(player) {
  if (!player || !player.isValid) return null;
  try {
    const id = getTag(player, "riftId:", null);
    if (id === null) return null;
    return {
      riftId: Number(id),
      x: Number(getTag(player, "riftReturnX:", 0)),
      y: Number(getTag(player, "riftReturnY:", 0)),
      z: Number(getTag(player, "riftReturnZ:", 0)),
      dim: getTag(player, "riftDim:", "minecraft:overworld")
    };
  } catch {
    return null;
  }
}

// ----- Feedback helpers -----
export function playRiftFeedback(dim, loc, particle, sound, volume = 1.0, pitch = 1.0) {
  try {
    if (particle) dim.spawnParticle(particle, { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 });
  } catch {}
  try {
    if (sound) dim.playSound(sound, loc, { volume, pitch });
  } catch {}
}