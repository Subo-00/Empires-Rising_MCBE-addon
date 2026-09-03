import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { processSpawnerQueue } from "./troopLogic.js";
import { promptFactionJoin, getPlayerFaction, addPlayerSpawners } from "./faction.js";


// =========================
// CONFIG — tweak these to balance gameplay
// =========================

/** Dragon base HP and HP gained per level */
const DRAGON_BASE_HP = 20;
export const DRAGON_HP_PER_LEVEL = 10;

// =========================
// CONFIG — specific balancing
// =========================

/** Spawning costs per unit type */
const SPAWN_COSTS = {
    barbarian: { item: "subo:pure_soul", amount: 10 },
    archer: { item: "subo:pure_soul", amount: 12 },
    dragon: { item: "subo:pure_heart", amount: 1 }
};

/** Cap limits and upgrade info */
const CAP_CONFIG = {
    barbarian: { start: 2, max: 5, upgradeItem: "subo:pure_heart", upgradePrice: 1, jump: 1 },
    archer: { start: 2, max: 5, upgradeItem: "subo:pure_heart", upgradePrice: 1, jump: 1 },
    dragon: { start: 1, max: 1, upgradeItem: null, upgradePrice: 0, jump: 0 }
};

/** Max level a dragon can reach */
const DRAGON_MAX_LEVEL = 5;


// =========================
// ENTITY / BLOCK IDs
// =========================

const SPAWNER_ENTITY = "subo:spawner_entity";

/** All block typeIds that count as spawner blocks */
const SPAWNER_BLOCK_IDS = [
    "subo:barbarian_spawner",
    "subo:archer_spawner",
    "subo:dragon_spawner"
];

// =========================
// TIERS & COLORS
// =========================

/** Upgrade tiers in order — order matters for sequential upgrade checks */
const TIERS = ["Copper", "Iron", "Diamond", "Netherite"];

/** Minecraft color codes for each tier (used in UI and lore) */
const TIER_COLORS = {
    None: "§8",
    Copper: "§6",
    Iron: "§f",
    Diamond: "§b",
    Netherite: "§5"
};

/** Color codes for each stat label in menus */
const STAT_COLORS = {
    owner: "§e",
    armor: "§d",
    weapon: "§c",
    cap: "§b"
};

/** Block item required to purchase each tier upgrade */
const COST_ITEMS = {
    Copper: "minecraft:copper_block",
    Iron: "minecraft:iron_block",
    Diamond: "minecraft:diamond_block",
    Netherite: "minecraft:netherite_block"
};

// =========================
// LOGIC
// =========================

/** Interaction cooldown in milliseconds (prevents double-open) */
const INTERACT_COOLDOWN_MS = 300;

/** Per-player cooldown map to prevent rapid double-interactions */
const interactCooldown = new Map();

/////////////////
// Main functions

export function handleSpawnerInteraction(ev) {
    const block = ev.block;
    if (!SPAWNER_BLOCK_IDS.includes(block.typeId)) return;

    const player = ev.player;
    if (player.isSneaking) return;

    const now = Date.now();
    const last = interactCooldown.get(player.id) ?? 0;
    if (now - last < INTERACT_COOLDOWN_MS) return;
    interactCooldown.set(player.id, now);

    const entity = getSpawnerEntity(player.dimension, block);
    if (!entity) return;

    ev.cancel = true;

    const unitType = getTag(entity, "type:", "barbarian");
    const isArcher = unitType === "archer";
    const isDragon = unitType === "dragon";
    const owner = getTag(entity, "owner:", "unknown");
    const cap = Number(getTag(entity, "cap:", CAP_CONFIG[unitType].start));

    const costData = SPAWN_COSTS[unitType];
    const costItemName = costData.item.split(":")[1].replace("_", " ");

    const form = new ActionFormData()
        .title(isDragon ? "§5 Dragon Spawner " : isArcher ? "§6🏹 Archer Spawner 🏹" : "§6⚔ Barbarian Spawner ⚔")
        .body(
            `${STAT_COLORS.owner}Owner: §f${owner}\n` +
            `${isDragon ? `§dLevel: §f${getTag(entity, "level:", 1)}` : `${STAT_COLORS.armor}Armor: §f${getTag(entity, "armor:", "None")}\n${STAT_COLORS.weapon}Weapon: §f${getTag(entity, "weapon:", "None")}`}\n` +
            `${STAT_COLORS.cap}Cap: §f${cap}\n\n` +
            `§7Cost: §e${costData.amount} ${costItemName} §7per unit`
        );

    // Dynamic buttons
    form.button(isArcher ? "§aSpawn Archers" : isDragon ? "§aSpawn Dragons" : "§aSpawn Barbarians");

    if (isDragon) {
        form.button("§dUpgrade Dragon Level");
    } else {
        form.button(`${STAT_COLORS.armor}Upgrade Armor`);
        form.button(`${STAT_COLORS.weapon}Upgrade Weapon`);
    }
    form.button(`${STAT_COLORS.cap}Upgrade Cap`);

    system.run(() => {
        form.show(player).then((res) => {
            if (res.canceled) return;

            if (res.selection === 0) {
                const faction = getPlayerFaction(player);
                if (faction === 0) {
                    promptFactionJoin(player).then(f => {
                        if (f > 0) openSpawnMenu(player, entity);
                    });
                    return;
                }
                openSpawnMenu(player, entity);
            } else if (isDragon) {
                if (res.selection === 1) openDragonLevelMenu(player, entity);
                if (res.selection === 2) openUpgradeMenu(player, entity, "cap");
            } else {
                if (res.selection === 1) openUpgradeMenu(player, entity, "armor");
                if (res.selection === 2) openUpgradeMenu(player, entity, "weapon");
                if (res.selection === 3) openUpgradeMenu(player, entity, "cap");
            }
        });
    });
}

function openSpawnMenu(player, entity) {
    const unitType = getTag(entity, "type:", "barbarian");
    const costData = SPAWN_COSTS[unitType];

    const cap = Number(getTag(entity, "cap:", CAP_CONFIG[unitType].start));
    const alive = Number(getTag(entity, "alive:", 0));
    const queue = Number(getTag(entity, "queue:", 0));

    const free = cap - alive - queue;
    if (free <= 0) {
        player.sendMessage("§cSpawner is full!");
        return;
    }

    const isArcher = unitType === "archer";
    const isDragon = unitType === "dragon";
    const label = isDragon ? "§aSpawn Dragons" : isArcher ? "§aSpawn Archers" : "§aSpawn Barbarians";
    const unitName = isDragon ? "dragons" : isArcher ? "archers" : "barbarians";

    const form = new ModalFormData()
        .title(label)
        .slider("Amount", 1, free, { valueStep: 1, defaultValue: 1 });

    form.show(player).then(res => {
        if (res.canceled) return;

        const amount = res.formValues[0];
        const totalCost = amount * costData.amount;

        if (!removeItem(player, costData.item, totalCost)) {
            const itemName = costData.item.split(":")[1].replace("_", " ");
            player.sendMessage(`§cYou need ${totalCost} ${itemName}!`);
            return;
        }

        const currentQueue = Number(getTag(entity, "queue:", 0));
        setTag(entity, "queue:", currentQueue + amount);
        player.sendMessage(`§aQueued ${amount} ${unitName}!`);

        processSpawnerQueue(entity);
    });
}

function openDragonLevelMenu(player, entity) {
    const currentLevel = Number(getTag(entity, "level:", 1));

    if (currentLevel >= DRAGON_MAX_LEVEL) {
        player.sendMessage("§5Dragon is already at max level!");
        return;
    }

    const nextLevel = currentLevel + 1;
    const cost = currentLevel; // 1→2 costs 1, 2→3 costs 2, etc.

    const nextHp = DRAGON_BASE_HP + (currentLevel) * DRAGON_HP_PER_LEVEL;

    // Cooldown factor used by dragon.js (Level 1 = 100%, Level 5 ≈ 40%)
    const cooldownPercent = Math.round(Math.max(40, 100 - (nextLevel - 1) * 15));

    const form = new ActionFormData()
        .title("§5Upgrade Dragon Level")
        .body(
            `§7Current Level: §d${currentLevel}\n` +
            `§7Next Level:    §d${nextLevel}\n\n` +
            `§7New Stats:\n` +
            `§7  HP: §c${nextHp}\n` +
            `§7  Attack Speed: §a${cooldownPercent}% of base cooldown\n` +
            `§8  (lower % = faster bites & fireballs)\n\n` +
            `§7Cost: §5${cost} Netherite Block(s)`
        )
        .button(`§5Upgrade to Level ${nextLevel}`)
        .button("§7Cancel");

    system.run(() => {
        form.show(player).then((res) => {
            if (res.canceled || res.selection === 1) return;

            if (!removeItem(player, "minecraft:netherite_block", cost)) {
                player.sendMessage(`§cYou need ${cost} Netherite Block(s)!`);
                return;
            }

            setTag(entity, "level:", nextLevel);
            player.sendMessage(
                `§5Dragon upgraded to Level §f${nextLevel}§5! ` +
                `HP: §c${nextHp} §5| Attack Speed: §a${cooldownPercent}%`
            );
        });
    });
}

function openUpgradeMenu(player, entity, stat) {
    const unitType = getTag(entity, "type:", "barbarian");
    const config = CAP_CONFIG[unitType];
    const currentCap = Number(getTag(entity, "cap:", config.start));

    const form = new ActionFormData().title(`§eUpgrade ${stat}`);

    if (stat === "cap") {
        // Handle Dragon or Maxed Spawners
        if (unitType === "dragon" || currentCap >= config.max) {
            player.sendMessage("§cThis spawner has reached its maximum unit cap!");
            return;
        }

        const itemName = config.upgradeItem.split(":")[1].replace("_", " ");
        form.button(`§aIncrease Cap §7(+${config.jump})\n§8Cost: ${config.upgradePrice} ${itemName}`);
    } else {
        // Already max tier → do not open the form
        const currentTier = getTag(entity, stat + ":", "None");
        if (currentTier === "Netherite") {
            player.sendMessage(`§c${stat} is already at maximum tier (Netherite)!`);
            return;
        }

        form.body("§7Choose any higher tier.\n§8You will pay every intermediate block.");
        for (const tier of TIERS) {
            const color = TIER_COLORS[tier];
            form.button(`${color}${tier}`);
        }
    }

    system.run(() => {
        form.show(player).then((res) => {
            if (res.canceled) return;

            if (stat === "cap") {
                if (!removeItem(player, config.upgradeItem, config.upgradePrice)) {
                    const itemName = config.upgradeItem.split(":")[1].replace("_", " ");
                    player.sendMessage(`§cYou need ${config.upgradePrice} ${itemName}!`);
                    return;
                }

                const newCap = currentCap + config.jump;
                setTag(entity, "cap:", newCap);
                player.sendMessage(`§aUnit cap increased to §f${newCap}!`);
                openUpgradeMenu(player, entity, stat);
                return;
            }

            // ========== NEW JUMP-UPGRADE LOGIC ==========
            const selectedTier = TIERS;                 // same order as the buttons
            const targetTier = selectedTier[res.selection];
            const currentTier = getTag(entity, stat + ":", "None");

            if (!canUpgrade(currentTier, targetTier)) {
                player.sendMessage("§cYou can only upgrade to a higher tier!");
                return;
            }

            const currentIndex = TIERS.indexOf(currentTier); // -1 for None
            const targetIndex  = TIERS.indexOf(targetTier);

            // Collect every tier that must be paid (current+1 … target)
            const requiredTiers = TIERS.slice(currentIndex + 1, targetIndex + 1);

            // First check that the player has one of each required block
            for (const t of requiredTiers) {
                const itemId = COST_ITEMS[t];
                if (!hasItem(player, itemId, 1)) {
                    player.sendMessage(`§cYou need 1 ${t} Block!`);
                    return;
                }
            }

            // Now remove them
            for (const t of requiredTiers) {
                removeItem(player, COST_ITEMS[t], 1);
            }

            upgradeStat(entity, stat, targetTier);

            player.sendMessage(
                `§aUpgraded ${STAT_COLORS[stat]}${stat} §ato ${TIER_COLORS[targetTier]}${targetTier}!`
            );
            // form closes – no reopen
        });
    });
}

export function breakSpawner(ev) {
    const block = ev.block;
    const dimension = ev.dimension;

    // Get the type of block that was broken
    const brokenTypeId = ev.brokenBlockPermutation.type.id;

    const entity = getSpawnerEntity(dimension, block);
    if (!entity) return;

    const unitType = getTag(entity, "type:", "barbarian");
    const data = {
        owner: getTag(entity, "owner:", "unknown"),
        armor: getTag(entity, "armor:", "None"),
        weapon: getTag(entity, "weapon:", "None"),
        cap: getTag(entity, "cap:", CAP_CONFIG[unitType].start),
        type: unitType,
        level: getTag(entity, "level:", 1)
    };

    system.run(() => {
        dimension.playSound("dig.stone", block.location);

        // Drop the correct block type back as item
        const item = new ItemStack(brokenTypeId, 1);
        item.setLore(createLore(data));
        dimension.spawnItem(item, blockCenter(block));

        const id = getTag(entity, "id:", "");
        const alive = Number(getTag(entity, "alive:", 0));

        // Kill every currently-loaded troop tied to this spawner.
        let killedCount = 0;
        for (const e of dimension.getEntities({ tags: ["spawner:" + id] })) {
            try {
                // Strip the tag BEFORE killing: the spawner is about to be removed,
                // so we don't want the entityDie handler trying (and failing) to find it
                // and queueing a pointless alive-decrement for an id that no longer exists.
                e.removeTag("spawner:" + id);
                e.kill();
                killedCount++;
            } catch { }
        }

        // Anything we couldn't reach right now (unloaded, out of simulation range, etc.)
        // gets queued for the periodic cleanup pass to hunt down once it loads back in.
        const remaining = alive - killedCount;
        if (remaining > 0) {
            addToKillQueue(id, remaining);
        }

        // This spawner is gone for good — any pending "alive" decrements queued
        // against its id are now meaningless, so drop them.
        clearFromDecrementQueue(id);

        if (alive > 0) {
            const costData = SPAWN_COSTS[unitType];
            let refundItem = costData.item;
            let refundPerUnit = Math.floor(costData.amount / 2);

            if (costData.item === "subo:pure_heart") {
                refundItem = "subo:pure_soul";
                refundPerUnit = 15;
            }

            const totalRefund = alive * refundPerUnit;
            if (totalRefund > 0) {
                const refundStack = new ItemStack(refundItem, totalRefund);
                dimension.spawnItem(refundStack, blockCenter(block));
            }
        }

        // Decrease the owner's spawner count
        const ownerName = getTag(entity, "owner:", "");
        const owner = [...world.getPlayers()].find(p => p.name === ownerName);
        if (owner) {
            addPlayerSpawners(owner, -1);
        }

        entity.remove();
    });
}

export function placeSpawner(ev, unitType = "barbarian") {
    const block = ev.block;
    const player = ev.player;
    const item = player.getComponent("minecraft:inventory")?.container.getItem(player.selectedSlotIndex);

    if (!item) return;

    const cap = CAP_CONFIG[unitType].start;

    const lore = item.getLore();
    const data = parseLore(lore);
    const id = generateId();


    system.run(() => {
        const entity = ev.dimension.spawnEntity("subo:spawner_entity", getStorageLocation(block));

        setTag(entity, "owner:", player.name);
        setTag(entity, "armor:", data.armor);
        setTag(entity, "weapon:", data.weapon);
        setTag(entity, "cap:", data.cap ?? cap);
        setTag(entity, "id:", id);
        setTag(entity, "alive:", 0);
        setTag(entity, "queue:", 0);
        setTag(entity, "type:", unitType);
        setTag(entity, "level:", data.level ?? 1);

        // Track placed spawners
        addPlayerSpawners(player, 1);
    });
}



// =========================
// Helpers
// =========================

// Any higher tier is allowed (None → any, Copper → Diamond/Netherite, etc.)
function canUpgrade(current, next) {
    const currentIndex = TIERS.indexOf(current); // -1 for "None"
    const nextIndex = TIERS.indexOf(next);
    return nextIndex > currentIndex;
}

function hasItem(player, itemId, amount = 1) {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    let total = 0;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && item.typeId === itemId) {
            total += item.amount;
            if (total >= amount) return true;
        }
    }
    return false;
}

function removeItem(player, itemId, amount = 1) {
    const inv = player.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;

    // Count total available across all slots
    let total = 0;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (item && item.typeId === itemId) {
            total += item.amount;
        }
    }
    if (total < amount) return false;

    // Remove from multiple stacks if needed
    let remaining = amount;
    for (let i = 0; i < inv.size; i++) {
        const item = inv.getItem(i);
        if (!item || item.typeId !== itemId) continue;

        if (item.amount <= remaining) {
            remaining -= item.amount;
            inv.setItem(i, undefined);
        } else {
            item.amount -= remaining;
            inv.setItem(i, item);
            remaining = 0;
        }
        if (remaining <= 0) break;
    }
    return true;
}

function upgradeStat(entity, stat, tier) {
    setTag(entity, stat + ":", tier);
}

function blockCenter(block) {
    return {
        x: block.location.x + 0.5,
        y: block.location.y + 0.5,
        z: block.location.z + 0.5
    };
}

// Returns the Y-offset storage position for a spawner entity.
// Eg. overworld: -64 to 320, midpoint = 128. Offset = 190 (safe in all cases).
// If block is above midpoint → store below; if at/below → store above.
// We use an offset so it never gets accidentally destroyed (by the Warden)
export function getStorageLocation(block) {
    const center = blockCenter(block);
    const dimId = block.dimension?.id ?? "minecraft:overworld";

    let offsetY;

    if (dimId === "minecraft:nether") {
        // Safe range in Nether is roughly 5 → 120
        // Prefer above the portal if there's room, otherwise below
        if (center.y < 60) {
            offsetY = Math.min(center.y + 40, 115);   // go up, but stay under roof
        } else {
            offsetY = Math.max(center.y - 40, 10);    // go down
        }
    } else if (dimId === "minecraft:the_end") {
        // End is 0–255, but islands are low
        offsetY = center.y > 80 ? center.y - 60 : center.y + 60;
        offsetY = Math.max(10, Math.min(offsetY, 240));
    } else {
        // Overworld
        const STORAGE_Y_MIDPOINT = 128; // Y midpoint used to decide which direction to offset the storage entity
        const STORAGE_Y_OFFSET = 192;
        offsetY = center.y > STORAGE_Y_MIDPOINT
            ? center.y - STORAGE_Y_OFFSET
            : center.y + STORAGE_Y_OFFSET;
    }

    return { x: center.x, y: offsetY, z: center.z };
}

function stripColors(text) {
    return text.replace(/§./g, "");
}

function parseLore(lore) {
    const data = {
        owner: "unknown",
        armor: "None",
        weapon: "None",
        type: "barbarian",
        level: 1
    };

    if (!lore) return data;

    for (let line of lore) {
        line = stripColors(line);

        if (line.startsWith("Owner:")) data.owner = line.split(": ")[1];
        if (line.startsWith("Armor:")) data.armor = line.split(": ")[1];
        if (line.startsWith("Weapon:")) data.weapon = line.split(": ")[1];
        if (line.startsWith("Cap:")) data.cap = Number(line.split(": ")[1]);
        if (line.startsWith("Type:")) {
            data.type = line.split(": ")[1];
            // If Cap wasn’t present in lore, update the default to match the real type
            if (!lore.some(l => stripColors(l).startsWith("Cap:"))) {
                data.cap = CAP_CONFIG[data.type]?.start ?? CAP_CONFIG.barbarian.start;
            }
        }
        if (line.startsWith("Level:")) data.level = Number(line.split(": ")[1]);
    }

    return data;
}

function createLore(data) {
    const lines = [
        `§7Owner: ${STAT_COLORS.owner}${data.owner}`,
        `§7Type: §f${data.type}`,
        `§7Cap: ${STAT_COLORS.cap}${data.cap}`
    ];

    if (data.type === "dragon") {
        lines.push(`§7Level: §5${data.level ?? 1}`);
    } else {
        lines.splice(2, 0,
            `§7Armor: ${TIER_COLORS[data.armor] ?? "§8"}${data.armor}`,
            `§7Weapon: ${TIER_COLORS[data.weapon] ?? "§8"}${data.weapon}`
        );
    }

    return lines;
}

function generateId() {
    return Math.random().toString(36).substring(2, 10);
}

// =========================
// TAG SYSTEM
// =========================

export function setTag(entity, prefix, value) {
    for (const tag of entity.getTags()) {
        if (tag.startsWith(prefix)) {
            entity.removeTag(tag);
        }
    }
    entity.addTag(`${prefix}${value}`);
}

export function getTag(entity, prefix, fallback) {
    const tag = entity.getTags().find(t => t.startsWith(prefix));
    if (!tag) return fallback;

    return tag.split(":")[1];
}

function getSpawnerEntity(dimension, block) {
    const entities = dimension.getEntities({
        type: SPAWNER_ENTITY,
        location: getStorageLocation(block),
        maxDistance: 0.5
    });

    return entities[0];
}


// =========================
// PERSISTENT CLEANUP QUEUES (scoreboard-backed)
// =========================
//
// Two objectives act as persistent "Map<spawnerId, amount>" storage that survives
// world/server restarts (unlike a plain JS Map, which would reset on script reload):
//
//   subo_kill_q  → troops that still need to be found & killed for a BROKEN spawner
//   subo_dec_q   → pending "alive - N" decrements waiting for a spawner to load back in
//
// A score of 0 removes the participant entirely, which is how an id "drops out" of the
// queue once there's nothing left to do for it.

const KILL_QUEUE_OBJECTIVE = "subo_kill_q";
const DECREMENT_QUEUE_OBJECTIVE = "subo_dec_q";
const CLEANUP_INTERVAL_TICKS = 100; // ~5 seconds

function ensureObjective(objectiveId, displayName) {
    let objective = world.scoreboard.getObjective(objectiveId);
    if (!objective) {
        objective = world.scoreboard.addObjective(objectiveId, displayName ?? objectiveId);
    }
    return objective;
}

function getQueueScore(objectiveId, key) {
    const objective = ensureObjective(objectiveId);
    try {
        return objective.getScore(key) ?? 0;
    } catch {
        return 0; // no participant with that name yet
    }
}

function setQueueScore(objectiveId, key, value) {
    const objective = ensureObjective(objectiveId);
    if (value <= 0) {
        try {
            objective.removeParticipant(key);
        } catch { }
        return;
    }
    objective.setScore(key, value);
}

function addToQueue(objectiveId, key, amount) {
    if (amount <= 0) return;
    const current = getQueueScore(objectiveId, key);
    setQueueScore(objectiveId, key, current + amount);
}

function getAllQueueEntries(objectiveId) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective) return [];

    const entries = [];
    for (const participant of objective.getParticipants()) {
        let score = 0;
        try {
            score = objective.getScore(participant) ?? 0;
        } catch { }
        if (score > 0) {
            entries.push({ id: participant.displayName, score });
        }
    }
    return entries;
}

function addToKillQueue(id, amount) {
    addToQueue(KILL_QUEUE_OBJECTIVE, id, amount);
}

function addToDecrementQueue(id, amount = 1) {
    addToQueue(DECREMENT_QUEUE_OBJECTIVE, id, amount);
}

function clearFromDecrementQueue(id) {
    setQueueScore(DECREMENT_QUEUE_OBJECTIVE, id, 0);
}

function getAllDimensions() {
    return [
        world.getDimension("overworld"),
        world.getDimension("nether"),
        world.getDimension("the_end")
    ];
}

function findSpawnerEntityById(id) {
    for (const dim of getAllDimensions()) {
        const found = dim.getEntities({ type: SPAWNER_ENTITY, tags: ["id:" + id] });
        if (found.length > 0) return found[0];
    }
    return null;
}

function findTroopsBySpawnerId(id) {
    const results = [];
    for (const dim of getAllDimensions()) {
        results.push(...dim.getEntities({ tags: ["spawner:" + id] }));
    }
    return results;
}

/**
 * Call this whenever a troop dies and you need to decrement its spawner's "alive" tag.
 * Tries to find the spawner right now; if it's unloaded, queues the decrement so the
 * periodic cleanup pass can apply it once the spawner loads back in.
 */
export function decrementSpawnerAlive(id, amount = 1) {
    if (!id) return;

    const spawner = findSpawnerEntityById(id);
    if (!spawner) {
        addToDecrementQueue(id, amount);
        return;
    }

    // Found it live — apply this decrement plus anything still backlogged from earlier misses.
    const pending = getQueueScore(DECREMENT_QUEUE_OBJECTIVE, id);
    const totalDecrement = amount + pending;

    const alive = Number(getTag(spawner, "alive:", 0));
    setTag(spawner, "alive:", Math.max(0, alive - totalDecrement));

    if (pending > 0) {
        setQueueScore(DECREMENT_QUEUE_OBJECTIVE, id, 0);
    }
}

/**
 * Runs every CLEANUP_INTERVAL_TICKS. Drains both queues:
 *  - hunts down leftover troops from broken spawners and kills them
 *  - applies pending "alive" decrements to spawners that have since loaded back in
 */
function runQueuedCleanup() {
    for (const { id, score } of getAllQueueEntries(KILL_QUEUE_OBJECTIVE)) {
        const troops = findTroopsBySpawnerId(id);
        if (troops.length === 0) continue;

        let killed = 0;
        for (const troop of troops) {
            try {
                troop.removeTag("spawner:" + id); // spawner's gone — no decrement should be queued from this death
                troop.kill();
                killed++;
            } catch { }
        }

        setQueueScore(KILL_QUEUE_OBJECTIVE, id, score - killed);
    }

    for (const { id, score } of getAllQueueEntries(DECREMENT_QUEUE_OBJECTIVE)) {
        const spawner = findSpawnerEntityById(id);
        if (!spawner) continue;

        try {
            const alive = Number(getTag(spawner, "alive:", 0));
            setTag(spawner, "alive:", Math.max(0, alive - score));
            setQueueScore(DECREMENT_QUEUE_OBJECTIVE, id, 0);
        } catch { }
    }
}

system.runInterval(runQueuedCleanup, CLEANUP_INTERVAL_TICKS);