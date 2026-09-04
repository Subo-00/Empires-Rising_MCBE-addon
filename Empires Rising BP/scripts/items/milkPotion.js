import { world, system, EntityDamageCause, MolangVariableMap } from "@minecraft/server";
import { MILK_PROJECTILE_ID, SPLASH_RADIUS } from "../config/itemsConfig.js";


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

    // Glass break sound (like a real potion)
    dimension.playSound("random.glass", location, { pitch: 1.0, volume: 1.0 });

    // White potion particles (closest to milk)
    const particleMolang = new MolangVariableMap();
    try {
        particleMolang.setColorRGBA("variable.color", {
            red: 1, green: 1, blue: 1, alpha: 1
        });
    } catch {}

    // Main splash cloud
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

    // Extra particles right where the potion landed
    for (let i = 0; i < 12; i++) {
        try {
            dimension.spawnParticle("minecraft:mobspell_emitter", {
                x: location.x + (Math.random() - 0.5) * 1.2,
                y: location.y + 0.3 + Math.random() * 0.8,
                z: location.z + (Math.random() - 0.5) * 1.2
            }, particleMolang);
        } catch {}
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