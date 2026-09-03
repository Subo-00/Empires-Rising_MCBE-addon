// ---- Enemy pools per tier ----
const SPAWN_TIERS = {
    "subo:random_spawner_1": {
        min: 2, max: 3,
        pool: [
            { id: "minecraft:pillager", weight: 6 },
            { id: "minecraft:vindicator", weight: 3 },
        ],
    },
    "subo:random_spawner_2": {
        min: 4, max: 5,
        pool: [
            { id: "minecraft:pillager", weight: 4 },
            { id: "minecraft:vindicator", weight: 4 },
            { id: "minecraft:witch", weight: 2 },
        ],
    },
    "subo:random_spawner_3": {
        min: 5, max: 6,
        pool: [
            { id: "minecraft:vindicator", weight: 3 },
            { id: "minecraft:witch", weight: 3 },
            { id: "minecraft:evocation_illager", weight: 2 }, // evoker
        ],
    },
};

const DEFAULT_SPAWN = SPAWN_TIERS["subo:random_spawner_1"];

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickWeighted(pool) {
    const total = pool.reduce((sum, e) => sum + e.weight, 0);
    let roll = Math.random() * total;
    for (const entry of pool) {
        roll -= entry.weight;
        if (roll < 0) return entry;
    }
    return pool[pool.length - 1];
}

// Spawn a random number of enemies, then remove the block.
export function spawnRandomEnemies(block, dimension) {
    const tier = SPAWN_TIERS[block.typeId] ?? DEFAULT_SPAWN;
    const count = randInt(tier.min, tier.max);

    const origin = {
        x: block.location.x + 0.5,
        y: block.location.y + 1,
        z: block.location.z + 0.5
    };

    for (let i = 0; i < count; i++) {
        const loc = {
            x: origin.x,
            y: origin.y,
            z: origin.z,
        };

        const entry = pickWeighted(tier.pool);

        try {
            const isPillager = entry.id === "minecraft:pillager";
            const name = "§r";

            if (isPillager) {
                // Only pillagers get the invisible nametag (for persistence + later detection)
                dimension.runCommand(
                    `summon ${entry.id} ${loc.x.toFixed(3)} ${loc.y.toFixed(3)} ${loc.z.toFixed(3)} 0 0 minecraft:entity_spawned "${name}"`
                );
            } else {
                // Everyone else is summoned normally (no nametag)
                dimension.runCommand(
                    `summon ${entry.id} ${loc.x.toFixed(3)} ${loc.y.toFixed(3)} ${loc.z.toFixed(3)} 0 0 minecraft:entity_spawned`
                );
            }
        } catch (e) {
            // ignore failed spawns
        }
    }

    block.setType("minecraft:air");
}