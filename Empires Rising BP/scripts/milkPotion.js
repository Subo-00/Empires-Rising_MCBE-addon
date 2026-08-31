import { world, system, EntityDamageCause, MolangVariableMap } from "@minecraft/server";

const MILK_PROJECTILE_ID = "subo:milk_potion_projectile";
const SPLASH_RADIUS = 5;

function clearEffectsAndSpawnParticles(dimension, location) {
    const nearby = dimension.getEntities({
        location,
        maxDistance: SPLASH_RADIUS
    });

    for (const entity of nearby) {
        try {
            for (const effect of entity.getEffects()) {
                entity.removeEffect(effect.typeId);
            }
        } catch {}
    }

    const particleMolang = new MolangVariableMap();
    try {
        particleMolang.setColorRGBA("variable.color", {
            red: 1, green: 1, blue: 1, alpha: 1
        });
    } catch {}

    for (let i = 0; i < 40; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.sqrt(Math.random()) * SPLASH_RADIUS;

        const particleLocation = {
            x: location.x + Math.cos(angle) * distance,
            y: location.y + 0.2 + Math.random() * 1.8,
            z: location.z + Math.sin(angle) * distance
        };

        try {
            dimension.spawnParticle("minecraft:mobspell_emitter", particleLocation, particleMolang);
        } catch {
            try {
                dimension.spawnParticle("minecraft:splash_spell_emitter", particleLocation);
            } catch {}
        }
    }
}

// Cancel damage from the milk potion + trigger the milk effect
world.beforeEvents.entityHurt.subscribe((event) => {
    const { damageSource, hurtEntity } = event;

    // Fast early exit for non-projectile damage
    if (damageSource.cause !== EntityDamageCause.projectile) return;

    const projectile = damageSource.damagingProjectile;
    if (!projectile || projectile.typeId !== MILK_PROJECTILE_ID) return;

    // Cancel the damage
    event.cancel = true;

    // Defer the actual milk effect (before-events are read-only)
    const location = hurtEntity.location;
    const dimension = hurtEntity.dimension;

    system.run(() => {
        clearEffectsAndSpawnParticles(dimension, location);

        // Optional: remove the projectile if it’s still around
        try {
            if (projectile.isValid) projectile.remove();
        } catch {}
    });
});

// Keep the block-hit version if you still want splash on blocks
world.afterEvents.projectileHitBlock.subscribe((event) => {
    const { projectile, location, dimension } = event;
    if (!projectile || projectile.typeId !== MILK_PROJECTILE_ID) return;

    system.run(() => {
        clearEffectsAndSpawnParticles(dimension, location);
        try { projectile.remove(); } catch {}
    });
});