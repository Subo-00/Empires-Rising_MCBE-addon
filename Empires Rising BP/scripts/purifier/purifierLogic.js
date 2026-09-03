import { world, system, ItemStack } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { getStorageLocation, setTag, getTag } from "../spawner/spawnerLogic.js";
import { spawnEmptySoul, killLinkedEmptySoulsDelayed, EMPTY_SOUL_SPAWN_EVERY, startEmptySoulTicker } from "./emptySoul.js";
import {
	PURIFIER_BLOCK, PURIFIER_ENTITY,
	UNDEAD_SPAWN_EVERY, MAX_UNDEAD_PER_PURIFIER, MAX_UNDEAD_SPAWN_DIST,
	MIN_PURIFY_TICKS, SKY_CHECK_INTERVAL, TICKS_PER_ITEM, MAX_STACK,
	UNDEAD, NIGHT_START, DAWN_START, INPUTS
} from "../config/purifierConfig.js";
import {
	trySetState, getNum, clamp, topOf, ensureId,
	isPurifying, clearState, getPurifierEntityAt, dropItems,
	killLinkedUndeadDelayed
} from "./purifierHelpers.js";

// Per-player form-open guard (prevents double-open from held-item + interact firing twice)
const formOpenPlayers = new Set();

// =============================================================================
// Placement -> spawn persistence entity (Overworld only)
// =============================================================================
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
	if (ev.block?.typeId !== PURIFIER_BLOCK) return;

	const player = ev.player;
	const dim = ev.block.dimension;
	const block = ev.block;

	// Reject placement outside the Overworld
	if (dim.id !== "minecraft:overworld") {
		system.run(() => {
			// Remove the block that was just placed
			block.setType("minecraft:air");

			// Give the item back (or drop it if inventory is full)
			const item = new ItemStack(PURIFIER_BLOCK, 1);
			const inv = player.getComponent("minecraft:inventory")?.container;
			if (inv) {
				const leftover = inv.addItem(item);
				// If addItem returns something, inventory was full
				if (leftover) {
					dim.spawnItem(leftover, player.location);
				}
			} else {
				// Fallback – just drop at the player's feet
				dim.spawnItem(item, player.location);
			}

			player.onScreenDisplay.setActionBar("§cThe Purifier can only be placed in the Overworld.");
			player.playSound("random.break");
		});
		return;
	}

	// Normal Overworld placement – spawn the persistence entity
	system.run(() => {
		if (!getPurifierEntity(dim, block)) {
			dim.spawnEntity(PURIFIER_ENTITY, getStorageLocation(block));
		}
	});
});

// =============================================================================
// Interaction -> open form
// =============================================================================
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
	const block = ev.block;
	if (block?.typeId !== PURIFIER_BLOCK) return;
	const player = ev.player;
	if (player.isSneaking) return;
	ev.cancel = true; // don't use held item normally
	if (formOpenPlayers.has(player.id)) return; // already opening
	formOpenPlayers.add(player.id);
	system.run(() => {
		openPurifierForm(player, block);
		// Release guard after a short delay so rapid re-clicks are still blocked
		system.runTimeout(() => formOpenPlayers.delete(player.id), 10);
	});
});

function openPurifierForm(player, block) {
	const dim = block.dimension;
	let entity = getPurifierEntity(dim, block);
	if (!entity) {
		console.warn("SOMEHOW ALREADY HAS PURIFIER ENTITY!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
		console.warn("purifier_" + block.location.x + "_" + block.location.y + "_" + block.location.z);

		// safety for blocks placed before this update
		entity = dim.spawnEntity(PURIFIER_ENTITY, getStorageLocation(block));
	}

	// Already purifying? show status instead of a new form.
	if (isPurifying(entity)) {
		const total = getNum(entity, "total:", 1);
		const remaining = getNum(entity, "remaining:", total);
		const pct = Math.min(100, Math.floor(((total - remaining) / total) * 100));
		player.onScreenDisplay.setActionBar(`§dPurifying... §f${pct}%`);
		return;
	}

	// --- Night-time check (overworld only) ---
	if (dim.id === "minecraft:overworld") {
		// Sky-exposure check: purifier must be the topmost block at its XZ
		const loc = block.location;
		const topBlock = dim.getTopmostBlock({ x: loc.x, z: loc.z });
		if (!topBlock || topBlock.y !== loc.y) {
			player.onScreenDisplay.setActionBar("§cThe purifier cannot see the sky.");
			return;
		}

		const timeOfDay = world.getTimeOfDay(); // 0-23999
		const isNight = timeOfDay >= NIGHT_START && timeOfDay < DAWN_START;
		if (!isNight) {
			player.onScreenDisplay.setActionBar("§cThe purifier only works at night.");
			return;
		}
	}

	// Count what the player holds for each input
	const counts = INPUTS.map((inp) => countItem(player, inp.id));
	const available = INPUTS.map((inp, i) => ({ ...inp, have: counts[i] })).filter((x) => x.have > 0);

	if (available.length === 0) {
		player.onScreenDisplay.setActionBar("§7You have no corrupted items to purify.");
		return;
	}

	const form = new ModalFormData().title("§5✦ Soul Purifier ✦");
	for (const a of available) {
		form.slider(`§7${a.label} §8(have ${a.have})`, 0, a.have, { valueStep: 1, defaultValue: 0 });
	}

	form.show(player).then((res) => {
		if (res.canceled) return;

		let totalItems = 0;
		let totalTicks = 0;
		const toPurify = [];
		available.forEach((a, i) => {
			const amt = Math.floor(res.formValues[i] ?? 0);

			if (amt > 0) {
				toPurify.push({ inp: a, amount: amt });
				totalItems += amt;
				totalTicks += amt * TICKS_PER_ITEM * (a.weight ?? 1);
			}
		});

		if (totalItems === 0) {
			player.onScreenDisplay.setActionBar("§7Nothing selected.");
			return;
		}

		// Dawn check: will purification finish before dawn?
		if (dim.id === "minecraft:overworld") {
			const timeOfDay = world.getTimeOfDay();
			const ticksUntilDawn = DAWN_START - timeOfDay;
			const ticksNeeded = Math.max(MIN_PURIFY_TICKS, totalTicks);   // ← use the forced minimum
			if (ticksNeeded > ticksUntilDawn) {
				player.onScreenDisplay.setActionBar(
					`§cNot enough night left! Need §f${Math.ceil(ticksNeeded / 20)}s§c, only §f${Math.ceil(ticksUntilDawn / 20)}s§c remain.`
				);
				return;
			}
		}

		// Consume from inventory (abort per-item if it fails)
		for (const t of toPurify) {
			const removed = removeItemAmount(player, t.inp.id, t.amount);
			if (removed < t.amount) t.amount = removed; // in case something changed
		}

		startPurify(dim, block, entity, toPurify, totalTicks);
		player.playSound("random.pop");
		player.onScreenDisplay.setActionBar(`§aPurifying §f${totalItems} §aitem(s)...`);
	});
}

// =============================================================================
// Start purification (store state on entity)
// =============================================================================
function startPurify(dim, block, entity, toPurify, totalTicks) {
	for (const inp of INPUTS) setTag(entity, inp.key + ":", 0);
	for (const t of toPurify) setTag(entity, t.inp.key + ":", t.amount);

	const loc = block.location;
	setTag(entity, "bx:", loc.x);
	setTag(entity, "by:", loc.y);
	setTag(entity, "bz:", loc.z);

	// Always run for at least 60 seconds
	const total = Math.max(MIN_PURIFY_TICKS, totalTicks);
	setTag(entity, "total:", total);
	setTag(entity, "remaining:", total);

	trySetState(block, true);

	activePurifierCount++;
	startPurifierTicker();
	startEmptySoulTicker();          // in case souls are about to spawn

	dim.playSound("subo.purifier.purify", loc);
}

// =============================================================================
// Global driver – only runs while at least one purifier is purifying
// =============================================================================
let purifierRunId = null;
let activePurifierCount = 0;

function startPurifierTicker() {
	if (purifierRunId !== null) return;
	purifierRunId = system.runInterval(() => {
		const dim = world.getDimension("minecraft:overworld");
		let ents;
		try { ents = dim.getEntities({ type: PURIFIER_ENTITY }); }
		catch (e) { return; }

		let anyActive = false;
		for (const e of ents) {
			if (isPurifying(e)) {
				anyActive = true;
				processPurifier(dim, e);
			}
		}
		if (!anyActive) stopPurifierTicker();
	}, 5);
}

function stopPurifierTicker() {
	if (purifierRunId === null) return;
	system.clearRun(purifierRunId);
	purifierRunId = null;
}

// processPurifier — decrement remaining each interval tick
function processPurifier(dim, entity) {
	if (!isPurifying(entity)) return;

	const loc = blockLoc(entity);
	if (!loc) return;

	const block = dim.getBlock(loc);
	if (!block) {
		// Chunk/sub-chunk not loaded yet — pause purification, do NOT wipe state
		return;
	}
	if (block.typeId !== PURIFIER_BLOCK) {
		// Block genuinely destroyed (e.g. exploded, soul reached it)
		clearState(entity);
		return;
	}

	const total = getNum(entity, "total:", 1);
	const remaining = getNum(entity, "remaining:", 0);
	const elapsed = total - remaining;
	const center = { x: loc.x + 0.5, y: loc.y + 0.9, z: loc.z + 0.5 };

	// Sky check (periodic)
	if (dim.id === "minecraft:overworld" && elapsed % SKY_CHECK_INTERVAL < 5) {
		const topBlock = dim.getTopmostBlock({ x: loc.x, z: loc.z });
		if (!topBlock || topBlock.y !== loc.y) {
			const fraction = clamp(elapsed / total, 0, 1);
			const dropAt = topOf(loc);
			for (const inp of INPUTS) {
				const amount = getNum(entity, inp.key + ":", 0);
				if (amount <= 0) continue;
				const purified = Math.floor(amount * fraction);
				const remaining_items = amount - purified;
				if (purified > 0) dropItems(dim, dropAt, inp.out, purified);
				if (remaining_items > 0) dropItems(dim, dropAt, inp.id, remaining_items);
			}
			dim.playSound("random.fizz", loc);
			const b = dim.getBlock(loc);
			if (b) trySetState(b, false);
			killLinkedUndeadDelayed(dim, entity);
			killLinkedEmptySoulsDelayed(dim, entity);
			activePurifierCount = Math.max(0, activePurifierCount - 1);
			if (activePurifierCount === 0) {
				stopPurifierTicker();
			}
			clearState(entity);
			return;
		}
	}

	dim.spawnParticle("subo:purify_particle", center);

	if (elapsed % UNDEAD_SPAWN_EVERY < 5) spawnUndead(dim, loc, entity);
	if (elapsed % EMPTY_SOUL_SPAWN_EVERY < 5) spawnEmptySoul(dim, loc, entity);

	// Decrement — interval fires every 5 ticks
	const newRemaining = remaining - 5;
	if (newRemaining <= 0) {
		finishPurify(dim, loc, entity);
	} else {
		setTag(entity, "remaining:", newRemaining);
	}
}

function finishPurify(dim, loc, entity) {
	for (const inp of INPUTS) {
		const amt = getNum(entity, inp.key + ":", 0);
		if (amt > 0) dropItems(dim, topOf(loc), inp.out, amt);
	}
	dim.playSound("subo.purifier.done", loc);
	dim.spawnParticle("subo:purify_particle", { x: loc.x + 0.5, y: loc.y + 1.0, z: loc.z + 0.5 });

	const block = dim.getBlock(loc);
	if (block) trySetState(block, false);
	clearState(entity);

	// kill undead linked to this purifier
	killLinkedUndeadDelayed(dim, entity);
	killLinkedEmptySoulsDelayed(dim, entity);
	activePurifierCount = Math.max(0, activePurifierCount - 1);
	if (activePurifierCount === 0) {
		stopPurifierTicker();
	}
}

// =============================================================================
// Break -> partial purification + drops
// =============================================================================
export function handlePurifierBreak(dim, loc) {
	const entity = getPurifierEntityAt(dim, loc);
	if (!entity) return;

	if (isPurifying(entity)) {
		const total = getNum(entity, "total:", 1);
		const remaining = getNum(entity, "remaining:", 0);
		const fraction = clamp((total - remaining) / total, 0, 1);
		const dropAt = topOf(loc);

		for (const inp of INPUTS) {
			const amount = getNum(entity, inp.key + ":", 0);
			if (amount <= 0) continue;

			const purified = Math.floor(amount * fraction);
			const remaining = amount - purified;

			// purified portion -> output
			if (purified > 0) dropItems(dim, dropAt, inp.out, purified);

			// unpurified portion -> each has 50% chance to survive as raw input
			let survived = 0;
			for (let i = 0; i < remaining; i++) if (Math.random() < 0.5) survived++;
			if (survived > 0) dropItems(dim, dropAt, inp.id, survived);
		}

		dim.playSound("random.fizz", loc);
	}

	killLinkedUndeadDelayed(dim, entity);
	killLinkedEmptySoulsDelayed(dim, entity);
	activePurifierCount = Math.max(0, activePurifierCount - 1);
	if (activePurifierCount === 0) {
		stopPurifierTicker();
	}
	entity.remove();
}

// =============================================================================
// Undead spawning  (around nearby players, phantoms above purifier)
// =============================================================================
function spawnUndead(dim, loc, entity) {
	const id = getTag(entity, "id:", null) ?? ensureId(entity);

	// cap check
	const linked = dim.getEntities({
		location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 },
		maxDistance: 8,
		tags: ["purifier_undead:" + id]
	});
	if (linked.length >= MAX_UNDEAD_PER_PURIFIER) return;

	// ~15% chance for a phantom
	const isPhantom = Math.random() < 0.15;
	const type = isPhantom
		? "minecraft:phantom"
		: UNDEAD[Math.floor(Math.random() * UNDEAD.length)];

	let spawnLoc;

	if (isPhantom) {
		// Phantoms spawn above the purifier (same idea as empty souls)
		spawnLoc = {
			x: loc.x + 0.5,
			y: loc.y + 2.5,   // a bit higher so they float nicely
			z: loc.z + 0.5
		};
	} else {
		// Normal undead → around a nearby player
		const players = dim.getPlayers({
			location: { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 },
			maxDistance: MAX_UNDEAD_SPAWN_DIST
		});
		if (players.length === 0) return;

		const player = players[Math.floor(Math.random() * players.length)];
		const pLoc = player.location;
		const pBlockX = Math.floor(pLoc.x);
		const pBlockY = Math.floor(pLoc.y);
		const pBlockZ = Math.floor(pLoc.z);

		const offsets = [
			[0, 0],
			[1, 0], [-1, 0], [0, 1], [0, -1],
			[1, 1], [1, -1], [-1, 1], [-1, -1]
		];

		// Shuffle
		for (let i = offsets.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[offsets[i], offsets[j]] = [offsets[j], offsets[i]];
		}

		spawnLoc = null;
		let attempts = 0;
		const MAX_ATTEMPTS = 2;

		for (const [dx, dz] of offsets) {

			if (attempts >= MAX_ATTEMPTS) break;

			const cx = pBlockX + dx;
			const cz = pBlockZ + dz;
			const yCandidates = [pBlockY, pBlockY + 1, pBlockY - 1];

			for (const cy of yCandidates) {
				if (Math.abs(cy - pBlockY) > 1) continue;

				const candidate = { x: cx + 0.5, y: cy, z: cz + 0.5 };
				if (isValidSpawnSpot(dim, candidate, pBlockY)) {
					spawnLoc = candidate;
					break;
				}

			}

			if (spawnLoc) break;
			attempts++;
		}

		// Fallback after 2 failed attempts → player position, no checks
		if (!spawnLoc) {
			spawnLoc = { x: pLoc.x, y: pLoc.y, z: pLoc.z };
		}
	}

	try {
		const mob = dim.spawnEntity(type, spawnLoc);
		mob.addTag("purifier_undead:" + id);
	} catch (e) { }
}

/**
 * Returns true when the location is a good mob spawn spot:
 * - solid block directly underneath
 * - the feet block and the head block are non-liquid-blocking
 *   (air, grass, flowers, etc.)
 * - Y is within ±1 of the reference player block Y
 */
function isValidSpawnSpot(dim, loc, playerBlockY) {
	const feetY = Math.floor(loc.y);
	if (Math.abs(feetY - playerBlockY) > 1) return false;


	const below = dim.getBlock({ x: Math.floor(loc.x), y: feetY - 1, z: Math.floor(loc.z) });
	const feet = dim.getBlock({ x: Math.floor(loc.x), y: feetY, z: Math.floor(loc.z) });
	const head = dim.getBlock({ x: Math.floor(loc.x), y: feetY + 1, z: Math.floor(loc.z) });

	if (!below || !feet || !head) return false;


	// Must stand on something solid
	if (!below.isLiquidBlocking("Water")) return false;

	// Feet + head must be non-liquid-blocking
	// (air / plants / etc. — anything that is neither solid nor a liquid)
	if (feet.isLiquidBlocking("Water") || head.isLiquidBlocking("Water")) return false;
	return true;
}

// =============================================================================
// Helpers
// =============================================================================
function isPurifying(entity) {
	return getNum(entity, "remaining:", 0) > 0;
}

function clearState(entity) {
	for (const tag of entity.getTags()) {
		if (["remaining:", "total:", "bx:", "by:", "bz:", ...INPUTS.map(i => i.key + ":")]
			.some(p => tag.startsWith(p))) {
			entity.removeTag(tag);
		}
	}
}

function blockLoc(entity) {
	const x = getTag(entity, "bx:", null);
	const y = getTag(entity, "by:", null);
	const z = getTag(entity, "bz:", null);
	if (x === null || y === null || z === null) return null;
	return { x: Number(x), y: Number(y), z: Number(z) };
}

function getPurifierEntity(dim, block) {
	return getPurifierEntityAt(dim, block.location);
}

// Count how many of itemId the player has
function countItem(player, itemId) {
	const inv = player.getComponent("minecraft:inventory")?.container;
	if (!inv) return 0;
	let n = 0;
	for (let i = 0; i < inv.size; i++) {
		const it = inv.getItem(i);
		if (it && it.typeId === itemId) n += it.amount;
	}
	return n;
}

// Remove up to `amount` across all stacks; returns how many were actually removed
function removeItemAmount(player, itemId, amount) {
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