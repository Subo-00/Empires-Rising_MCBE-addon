import { system, ItemStack, BlockPermutation } from "@minecraft/server";
import { getStorageLocation, setTag, getTag } from "../spawner/spawnerHelpers.js";

export const PORTAL_BLOCK = "subo:portal";
export const PORTAL_ENTITY = "subo:portal_entity";

export const BASE_MARKER = "§0§0PORTAL";
export const NAME_MARKER = "NAME";
export const LIST_MARKER = "LIST";

export const DIM_CODES = { "minecraft:overworld": 0, "minecraft:nether": 1, "minecraft:the_end": 2 };
export const DIM_NAMES = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
export const FACING_CODES = { north: 0, south: 1, west: 2, east: 3 };
export const FACING_NAMES = ["north", "south", "west", "east"];

// Player portal storage ============================================================

// Instead of one big list, store each portal as its own tag:
// "portal:<id>:<name>:<x>:<y>:<z>:<dimCode>:<facingCode>"
export function getPlayerPortals(player) {
    if (!player?.isValid) return [];
    const result = [];
    for (const tag of player.getTags()) {
        if (!tag.startsWith("portal:")) continue;
        const parts = tag.slice(7).split(":");
        if (parts.length < 7) continue;
        result.push(expandPortal([
            parts[0],          // id
            parts[1],          // name
            +parts[2], +parts[3], +parts[4],
            +parts[5], +parts[6]
        ]));
    }
    return result;
}

export function setPlayerPortals(player, portals) {
    // wipe old ones
    for (const t of [...player.getTags()]) {
        if (t.startsWith("portal:")) player.removeTag(t);
    }
    for (const p of portals) {
        const c = compactPortal(p);
        // keep under 256 easily
        player.addTag(`portal:${c[0]}:${c[1]}:${c[2]}:${c[3]}:${c[4]}:${c[5]}:${c[6]}`);
    }
}

export function addPlayerPortal(player, portal) {
    const list = getPlayerPortals(player);
    list.push(portal);
    setPlayerPortals(player, list);
}

export function removePlayerPortalById(player, id) {
    const list = getPlayerPortals(player).filter(p => p.id !== id);
    setPlayerPortals(player, list);
}

/** Turn the compact array back into the object the rest of the code expects */
export function expandPortal(arr) {
    return {
        id: arr[0],
        name: arr[1],
        x: arr[2],
        y: arr[3],
        z: arr[4],
        dim: DIM_NAMES[arr[5]] ?? "minecraft:overworld",
        facing: FACING_NAMES[arr[6]] ?? "north"
    };
}

/** Turn a normal portal object into the compact array */
export function compactPortal(p) {
    return [
        p.id,
        p.name,
        Math.floor(p.x),
        Math.floor(p.y),
        Math.floor(p.z),
        DIM_CODES[p.dim] ?? 0,
        FACING_CODES[p.facing] ?? 0
    ];
}

// Entity / block helpers ==========================================================

export function getPortalEntity(block) {
    if (!block) return null;

    const storageLoc = getStorageLocation(block);

    const ents = block.dimension.getEntities({
        type: PORTAL_ENTITY,
        location: storageLoc,
        maxDistance: 0.5
    });

    return ents[0] ?? null;
}

export function findPortalAt(block) {
    if (!block) return null;

    const entity = getPortalEntity(block);
    if (entity) {
        const portal = portalDataFromEntity(entity);
        if (portal?.id) return { owner: portal.owner, portal, entity };
    }

    return null;
}

export function portalDataFromEntity(entity) {
    if (!entity) return null;
    return {
        id: getTag(entity, "id:", null),
        name: getTag(entity, "name:", null),
        owner: getTag(entity, "owner:", null),
        x: Number(getTag(entity, "x:", 0)),
        y: Number(getTag(entity, "y:", 0)),
        z: Number(getTag(entity, "z:", 0)),
        dim: (getTag(entity, "dim:", null) || "").replace("_", ":"),   // back to "minecraft:overworld"
        facing: getTag(entity, "facing:", "north")
    };
}

export function removePortalEntity(entity) {
    if (entity?.isValid) entity.remove();
}

export function getLowerPortalBlock(block) {
    if (block.permutation.getState("subo:half") === "upper") {
        return block.dimension.getBlock({
            x: block.location.x,
            y: block.location.y - 1,
            z: block.location.z
        });
    }
    return block;
}

export function setActive(lowerBlock, active) {
    if (!lowerBlock || lowerBlock.typeId !== PORTAL_BLOCK) return;

    const upper = lowerBlock.dimension.getBlock({
        x: lowerBlock.location.x,
        y: lowerBlock.location.y + 1,
        z: lowerBlock.location.z
    });

    try {
        lowerBlock.setPermutation(
            lowerBlock.permutation.withState("subo:active", active)
        );
        if (upper?.typeId === PORTAL_BLOCK) {
            upper.setPermutation(
                upper.permutation.withState("subo:active", active)
            );
        }
    } catch { }
}

// Utilities ======================================================================================

export function playExpandParticle(dim, loc, maxRadius = 20, troop_radius) {
    let t = 0;
    const id = system.runInterval(() => {
        t += 1;
        const progress = t / 40;               // 2 seconds total
        const radius = progress < 0.5
            ? maxRadius * (progress * 2)       // grow
            : maxRadius * (2 - progress * 2);  // shrink

        // spawn a ring of particles
        try {
            for (let i = 0; i < troop_radius; i++) {
                const angle = (i / troop_radius) * Math.PI * 2;
                dim.spawnParticle("minecraft:mob_portal", {
                    x: loc.x + Math.cos(angle) * radius,
                    y: loc.y + 1,
                    z: loc.z + Math.sin(angle) * radius
                });
            }
        } catch (error) {
        }

        if (t >= 40) system.clearRun(id);
    }, 2);
}

export function tryGivePortalItem(player) {
    const TYPE = "subo:portal";
    const inv = player.getComponent("inventory")?.container;
    if (!inv) return false;

    // Prefer adding to an existing stack that still has room
    for (let i = 0; i < inv.size; i++) {
        const slot = inv.getItem(i);
        if (slot && slot.typeId === TYPE && slot.amount < slot.maxAmount) {
            slot.amount += 1;
            inv.setItem(i, slot);
            return true;
        }
    }

    // Otherwise use an empty slot
    if (inv.emptySlotsCount > 0) {
        inv.addItem(new ItemStack(TYPE, 1));
        return true;
    }

    return false; // completely full
}

export function cloneBlockLoc(loc) {
    return {
        x: Math.floor(loc.x),
        y: Math.floor(loc.y),
        z: Math.floor(loc.z)
    };
}

export function portalKeyFromLoc(dimId, loc) {
    return `${dimId}|${Math.floor(loc.x)}|${Math.floor(loc.y)}|${Math.floor(loc.z)}`;
}

export function lowerLocFromBrokenHalf(loc, half) {
    const out = cloneBlockLoc(loc);

    if (half === "upper") {
        out.y -= 1;
    }

    return out;
}

/** Returns a § color code based on the biome at the given location. */
export function getPortalNameColor(dim, loc) {
    // Dimension overrides first
    if (dim.id === "minecraft:nether") return "§c";          // red
    if (dim.id === "minecraft:the_end") return "§b";         // cyan / aqua

    // Overworld – try to be as specific as possible
    let biomeId = "";
    try {
        biomeId = dim.getBiome(loc)?.id ?? "";
    } catch { }

    // strip "minecraft:" if present
    biomeId = biomeId.replace("minecraft:", "");

    // Snow / ice
    if (biomeId.includes("frozen") || biomeId.includes("ice") || biomeId.includes("snow") || biomeId.includes("cold"))
        return "§f";   // white

    // Desert / dry
    if (biomeId.includes("desert") || biomeId.includes("badlands") || biomeId.includes("savanna"))
        return "§e";   // yellow

    // Ocean / water
    if (biomeId.includes("ocean") || biomeId.includes("river") || biomeId.includes("beach"))
        return "§9";   // blue

    // Jungle
    if (biomeId.includes("jungle"))
        return "§2";   // dark green

    // Forest / taiga
    if (biomeId.includes("forest") || biomeId.includes("taiga") || biomeId.includes("grove"))
        return "§a";   // green

    // Mountains / peaks
    if (biomeId.includes("mountain") || biomeId.includes("peak") || biomeId.includes("hills") || biomeId.includes("extreme"))
        return "§7";   // gray

    // Swamp / mangrove
    if (biomeId.includes("swamp") || biomeId.includes("mangrove"))
        return "§8";   // dark gray

    // Mushroom
    if (biomeId.includes("mushroom"))
        return "§d";   // light purple

    // Plains / meadow / cherry / default overworld
    return "§a";       // green
}