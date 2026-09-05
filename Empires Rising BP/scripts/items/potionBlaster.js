import { system, world, EquipmentSlot, EntityComponentTypes, ItemComponentTypes, MolangVariableMap } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { MAX_POTIONS, SPLASH_RADIUS, BASE_POTIONS, BASE_COLORS } from "../config/itemsConfig.js";

const ITEM_ID = "subo:potion_blaster";
const PROJECTILE_ID = "subo:potion_blaster_projectile";


// Generate POTION_TYPES / POTION_COLORS with distinct keys for the "II" (strong_) and
// extended (long_) variants, matching the raw ids Minecraft reports (e.g. "strong_poison",
// "long_poison"), so each tier keeps its own amplifier/duration and can't get mixed up.
const POTION_TYPES = {};
const POTION_COLORS = {};

for (const [key, base] of Object.entries(BASE_POTIONS)) {
    POTION_TYPES[key] = { name: base.name, effect: base.effect, amplifier: base.amplifier, duration: base.duration };
    POTION_COLORS[key] = BASE_COLORS[key];

    if (base.hasStrong) {
        POTION_TYPES[`strong_${key}`] = {
            name: `${base.name} II`,
            effect: base.effect,
            amplifier: base.amplifier + 1,
            duration: Math.max(1, Math.round(base.duration / 2)),
        };
        POTION_COLORS[`strong_${key}`] = BASE_COLORS[key];
    }

    if (base.hasLong) {
        POTION_TYPES[`long_${key}`] = {
            name: `${base.name} (Extended)`,
            effect: base.effect,
            amplifier: base.amplifier,
            duration: Math.round(base.duration * 2.5),
        };
        POTION_COLORS[`long_${key}`] = BASE_COLORS[key];
    }
}

POTION_TYPES.milk = { name: "Milk", clearEffects: true, radius: 5 };
POTION_COLORS.milk = { r: 1.00, g: 1.00, b: 1.00 };

const POTION_KEYS = Object.keys(POTION_TYPES);

// ---------- LORE-BASED DATA STORAGE (no dynamic properties) ----------
const LORE_TYPE_PREFIX = "§7Potion: §b";
const LORE_COUNT_PREFIX = "§7Charges: §f";

/** Reads { type, count } from nameTag + lore. */
function readPotionData(itemStack) {
    // Count is still stored in lore
    const lore = itemStack.getLore();
    let count = 0;
    if (lore && lore.length > 0) {
        const countMatch = (lore[0] ?? "").match(/(\d+)\s*\/\s*\d+/);
        count = countMatch ? parseInt(countMatch[1], 10) : 0;
    }

    // Type is now stored in the nameTag
    const nameTag = itemStack.nameTag ?? "";
    let type = null;

    // Expected format: "§rPotion Blaster\n§bMilk"  (or Healing II, etc.)
    const lines = nameTag.split("\n");
    if (lines.length >= 2) {
        // strip colour codes then match against known potion names
        const typeName = lines[1].replace(/§./g, "").trim();
        type = POTION_KEYS.find((k) => POTION_TYPES[k].name === typeName) ?? null;
    }

    return { type, count };
}

/** Writes the potion type + count into the item's lore / nameTag. */
function writePotionData(itemStack, type, count) {
    if (!type || count <= 0) {
        itemStack.setLore([]);
        itemStack.nameTag = undefined;          // empty → just "Potion Blaster"
        return;
    }

    // Lore only shows the charge count (no type → no double display)
    itemStack.setLore([
        `${LORE_COUNT_PREFIX}${count}/${MAX_POTIONS}`,
    ]);

    // Type lives only in the name so it is visible in the hotbar
    itemStack.nameTag = `§rPotion Blaster\n§b${POTION_TYPES[type].name}`;
}
// -----------------------------------------------------------------------

// ---------- INVENTORY <-> POTION TYPE MATCHING ----------

/** Returns the POTION_TYPES key this item stack represents, or null if it's not a usable potion/milk. */
function getPotionKeyFromItemStack(stack) {
    if (!stack) return null;

    // Support both vanilla milk buckets and your custom milk potion item
    if (stack.typeId === "minecraft:milk_bucket" || stack.typeId === "subo:milk_potion") {
        return "milk";
    }

    if (stack.typeId !== "minecraft:splash_potion") return null;

    try {
        const potionComp = stack.getComponent(ItemComponentTypes.Potion);
        if (!potionComp) {
            return null;
        }

        const deliveryType = potionComp.potionDeliveryType?.id;

        // In modern API versions splash potions report "ThrownSplash"
        if (deliveryType !== "ThrownSplash" && deliveryType !== "splash") {
            return null;
        }

        const rawId = potionComp.potionEffectType?.id ?? "";
        // Strip namespace only ("minecraft:strong_poison" -> "strong_poison").
        // Keep the strong_/long_ prefix so each tier is tracked as its own distinct type.
        const key = rawId.startsWith("minecraft:") ? rawId.substring(10) : rawId;

        return POTION_TYPES[key] ? key : null;
    } catch (e) {
        return null;
    }
}

/** Scans the player's inventory and returns { [potionKey]: totalCount }. */
function getInventoryPotionCounts(player) {
    const inv = player.getComponent(EntityComponentTypes.Inventory);
    const counts = {};
    if (!inv || !inv.container) {
        return counts;
    }

    const container = inv.container;

    for (let i = 0; i < container.size; i++) {
        const stack = container.getItem(i);
        if (!stack) continue;
        const key = getPotionKeyFromItemStack(stack);
        if (key) counts[key] = (counts[key] ?? 0) + stack.amount;
    }

    return counts;
}

/** Removes up to `amountNeeded` matching potions/milk buckets from the player's inventory. Returns amount actually removed. */
function removePotionsFromInventory(player, key, amountNeeded) {
    const inv = player.getComponent(EntityComponentTypes.Inventory);
    if (!inv || !inv.container) return 0;

    const container = inv.container;
    let remaining = amountNeeded;

    for (let i = 0; i < container.size && remaining > 0; i++) {
        const stack = container.getItem(i);
        if (!stack) continue;
        if (getPotionKeyFromItemStack(stack) !== key) continue;

        const take = Math.min(stack.amount, remaining);
        remaining -= take;

        if (take >= stack.amount) {
            container.setItem(i, undefined);
        } else {
            const newStack = stack.clone();
            newStack.amount = stack.amount - take;
            container.setItem(i, newStack);
        }
    }

    return amountNeeded - remaining;
}
// -----------------------------------------------------------------------

/** Tops off the Potion BLaster with `key` potions, consuming them from the player's inventory. */
function fillPotionBLaster(source, itemStack, equippable, key) {
    const { type, count } = readPotionData(itemStack);
    const currentCount = type === key ? count : 0;

    const needed = MAX_POTIONS - currentCount;
    if (needed <= 0) {
        source.sendMessage("§7The Potion Blaster is already full.");
        return;
    }

    const available = getInventoryPotionCounts(source)[key] ?? 0;
    if (available <= 0) {
        source.sendMessage(`§cYou don't have any ${POTION_TYPES[key].name} potions.`);
        return;
    }

    const toTake = Math.min(needed, available);
    const removed = removePotionsFromInventory(source, key, toTake);
    if (removed <= 0) return;

    const newCount = currentCount + removed;
    writePotionData(itemStack, key, newCount);
    equippable.setEquipment(EquipmentSlot.Mainhand, itemStack);

    // Feedback when loading
    const dim = source.dimension;
    const loc = source.location;
    dim.playSound("random.pop", loc, { pitch: 1.2, volume: 0.8 });
    for (let i = 0; i < 8; i++) {
        try {
            dim.spawnParticle("minecraft:rain_splash_particle", {
                x: loc.x + (Math.random() - 0.5) * 0.6,
                y: loc.y + 1.2 + Math.random() * 0.4,
                z: loc.z + (Math.random() - 0.5) * 0.6
            });
        } catch { }
    }

    source.sendMessage(`§aPotion Blaster filled with ${removed}x ${POTION_TYPES[key].name} (${newCount}/${MAX_POTIONS}).`);
}

function openFillMenu(source, current) {
    const { type: currentType, count: currentCount } = readPotionData(current);

    // Already holding a type -> just top it up, no need to choose.
    if (currentType && currentCount > 0) {
        const equippable = source.getComponent(EntityComponentTypes.Equippable);
        if (equippable) fillPotionBLaster(source, current, equippable, currentType);
        return;
    }

    const inventoryCounts = getInventoryPotionCounts(source);
    const availableKeys = POTION_KEYS.filter((k) => (inventoryCounts[k] ?? 0) > 0);

    if (availableKeys.length === 0) {
        source.sendMessage("§cYou don't have any splash potions (or milk buckets) to fill the Potion BLaster with.");
        return;
    }

    const form = new ActionFormData()
        .title("Potion Blaster")
        .body("Choose a potion type to fill the Potion BLaster with:");
    for (const key of availableKeys) {
        form.button(`${POTION_TYPES[key].name} (${inventoryCounts[key]} available)`);
    }

    form.show(source).then((response) => {
        if (response.canceled || response.selection === undefined) return;

        const equippable = source.getComponent(EntityComponentTypes.Equippable);
        if (!equippable) return;
        const freshCurrent = equippable.getEquipment(EquipmentSlot.Mainhand);
        if (!freshCurrent || freshCurrent.typeId !== ITEM_ID) return;

        const chosenKey = availableKeys[response.selection];
        fillPotionBLaster(source, freshCurrent, equippable, chosenKey);
    });
}

/** Fires the blaster: consumes one charge, spawns the projectile, and plays the sound. */
export function fireBlaster(player, itemStack) {
    const { type, count } = readPotionData(itemStack);

    if (!type || count <= 0) {
        player.sendMessage("§7The Potion Blaster is empty. Sneak + Use to choose a potion type.");
        return;
    }

    const newCount = count - 1;
    writePotionData(itemStack, newCount > 0 ? type : null, newCount);

        // Feedback when the blaster becomes empty
    if (newCount <= 0) {
        const dim = player.dimension;
        const loc = player.location;
        dim.playSound("random.fizz", loc, { pitch: 1.4, volume: 0.7 });
        for (let i = 0; i < 10; i++) {
            try {
                dim.spawnParticle("minecraft:basic_smoke_particle", {
                    x: loc.x + (Math.random() - 0.5) * 0.5,
                    y: loc.y + 1.3 + Math.random() * 0.3,
                    z: loc.z + (Math.random() - 0.5) * 0.5
                });
            } catch {}
        }
    }

    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (equippable) equippable.setEquipment(EquipmentSlot.Mainhand, itemStack);

    const dimension = player.dimension;
    const head = player.getHeadLocation();
    const view = player.getViewDirection();
    const spawnLoc = { x: head.x + view.x, y: head.y + view.y, z: head.z + view.z };

    const projectile = dimension.spawnEntity(PROJECTILE_ID, spawnLoc);
    projectile.addTag(`vq_${type}`); // carries the potion type without any dynamic property
    const projComp = projectile.getComponent("minecraft:projectile");
    if (projComp) projComp.shoot(view, { uncertainty: 1 });

    dimension.playSound("random.bow", head);
}

system.beforeEvents.startup.subscribe(({ itemComponentRegistry }) => {
    itemComponentRegistry.registerCustomComponent("subo:potion_blaster", {
        onUse(event) {
            const { source, itemStack } = event;
            if (!source || !itemStack) return;

            if (source.isSneaking) {
                openFillMenu(source, itemStack);
                return;
            }

            fireBlaster(source, itemStack);
        },
    });
});

function applySplashEffect(projectile) {
    try {
        // Prevent double-processing
        if (projectile.hasTag("vq_resolved")) return;
        projectile.addTag("vq_resolved");

        const tag = projectile.getTags().find((t) => t.startsWith("vq_") && t !== "vq_resolved");
        const type = tag ? tag.substring(3) : null;
        const data = POTION_TYPES[type];

        if (!data) {
            projectile.remove();
            return;
        }

        const location = projectile.location;
        const dimension = projectile.dimension;
        const radius = data.radius ?? SPLASH_RADIUS;

        // Apply/remove effects in the splash radius
        const nearby = dimension.getEntities({ location, maxDistance: radius });
        for (const entity of nearby) {
            try {
                if (data.clearEffects) {
                    for (const effect of entity.getEffects()) {
                        entity.removeEffect(effect.typeId);
                    }
                } else {
                    entity.addEffect(data.effect, data.duration, {
                        amplifier: data.amplifier,
                    });
                }
            } catch (error) {
                /* entity does not support effects */
            }
        }

        // Colored mobspell particles scattered across the splash area
        const color = POTION_COLORS[type] ?? { r: 1, g: 1, b: 1 };
        const molang = new MolangVariableMap();

        try {
            molang.setColorRGBA("variable.color", {
                red: color.r,
                green: color.g,
                blue: color.b,
                alpha: 1.0
            });
        } catch (error) {
            /* color tinting not supported for this particle; use default */
        }

        for (let i = 0; i < 40; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.sqrt(Math.random()) * radius;

            const particleLocation = {
                x: location.x + Math.cos(angle) * distance,
                y: location.y + 0.2 + Math.random() * 1.8,
                z: location.z + Math.sin(angle) * distance
            };

            try {
                dimension.spawnParticle("minecraft:mobspell_emitter", particleLocation, molang);
            } catch (error) {
                try {
                    dimension.spawnParticle("minecraft:splash_spell_emitter", particleLocation);
                } catch (fallbackError) {
                    /* ignore particle errors */
                }
            }
        }

        // Sound: glass for potions, splash for milk
        dimension.playSound(
            data.clearEffects ? "random.splash" : "random.glass",
            location
        );

        // Remove projectile manually since we removed remove_on_hit
        projectile.remove();
    } catch (error) {
        /* projectile may already be invalid */
    }
}

world.afterEvents.projectileHitEntity.subscribe((event) => {
    if (event.projectile.typeId !== PROJECTILE_ID) return;
    applySplashEffect(event.projectile);
});

world.afterEvents.projectileHitBlock.subscribe((event) => {
    if (event.projectile.typeId !== PROJECTILE_ID) return;
    applySplashEffect(event.projectile);
});