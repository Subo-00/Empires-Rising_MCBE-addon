import { system } from "@minecraft/server";
import { getStorageLocation, setTag, getTag } from "../spawner/spawnerHelpers.js";
import { RIFT_ENTITY } from "../config/riftConfig.js";

export function trySetState(block, value) {
  try {
    block.setPermutation(block.permutation.withState("subo:state", value));
  } catch {}
}

export function getNum(entity, prefix, fallback = 0) {
  const v = getTag(entity, prefix, null);
  return v === null ? fallback : Number(v);
}

export function setNum(entity, prefix, value) {
  setTag(entity, prefix, value);
}

export function ensureId(entity) {
  let id = getTag(entity, "id:", null);
  if (!id) {
    id = Math.random().toString(36).substring(2, 10);
    setTag(entity, "id:", id);
  }
  return id;
}

export function getRiftEntityAt(dim, loc) {
  const ents = dim.getEntities({
    type: RIFT_ENTITY,
    location: getStorageLocation({ location: loc, dimension: dim }),
    maxDistance: 0.5
  });
  return ents[0] ?? null;
}

export function isActive(entity) {
  return getNum(entity, "remaining:", 0) > 0;
}

export function isBroken(entity) {
  return getTag(entity, "broken:", null) === "1";
}

export function clearRiftState(entity) {
  const prefixes = [
    "remaining:", "total:", "riftId:", "bx:", "by:", "bz:",
    "pouchTotal:", "pouchOpened:", "fog:", "returnX:", "returnY:", "returnZ:"
  ];
  for (const tag of [...entity.getTags()]) {
    if (prefixes.some(p => tag.startsWith(p))) entity.removeTag(tag);
  }
}

export function blockLoc(entity) {
  const x = getTag(entity, "bx:", null);
  const y = getTag(entity, "by:", null);
  const z = getTag(entity, "bz:", null);
  if (x === null || y === null || z === null) return null;
  return { x: Number(x), y: Number(y), z: Number(z) };
}

// ----- Player rift tags -----
export function clearPlayerRiftTags(player) {
  const prefixes = ["riftId:", "riftReturnX:", "riftReturnY:", "riftReturnZ:", "riftDim:"];
  for (const tag of [...player.getTags()]) {
    if (prefixes.some(p => tag.startsWith(p))) player.removeTag(tag);
  }
}

export function setPlayerRiftTags(player, riftId, loc) {
  clearPlayerRiftTags(player);
  setTag(player, "riftId:", riftId);
  setTag(player, "riftReturnX:", loc.x);
  setTag(player, "riftReturnY:", loc.y);
  setTag(player, "riftReturnZ:", loc.z);
  setTag(player, "riftDim:", "minecraft:overworld");
}

export function getPlayerRiftReturn(player) {
  const id = getTag(player, "riftId:", null);
  if (id === null) return null;
  return {
    riftId: Number(id),
    x: Number(getTag(player, "riftReturnX:", 0)),
    y: Number(getTag(player, "riftReturnY:", 0)),
    z: Number(getTag(player, "riftReturnZ:", 0)),
    dim: getTag(player, "riftDim:", "minecraft:overworld")
  };
}

// ----- Inventory -----
export function countItem(player, itemId) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return 0;
  let n = 0;
  for (let i = 0; i < inv.size; i++) {
    const it = inv.getItem(i);
    if (it && it.typeId === itemId) n += it.amount;
  }
  return n;
}

export function removeItemAmount(player, itemId, amount) {
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return 0;
  let left = amount;
  for (let i = 0; i < inv.size && left > 0; i++) {
    const it = inv.getItem(i);
    if (!it || it.typeId !== itemId) continue;
    if (it.amount <= left) {
      left -= it.amount;
      inv.setItem(i, undefined);
    } else {
      it.amount -= left;
      inv.setItem(i, it);
      left = 0;
    }
  }
  return amount - left;
}