import { world } from "@minecraft/server";

const _OBJECTIVE_ID = "ticking_areas";

// Monotonically increasing counter appended to ticking area names.
// Prevents name collisions when multiple regions are processed concurrently
// and happen to target the same chunk coordinates.
let _tickingAreaCounter = 0;

// Tracks all currently active ticking area names
const _activeAreas = new Set();

export function setupScoreboard() {
    if (!world.scoreboard.getObjective(_OBJECTIVE_ID)) {
        world.scoreboard.addObjective(_OBJECTIVE_ID, "Active Ticking Areas");
    }
}

// Builds a unique ticking area name from a prefix, coordinates, and a counter.
// Hyphens are replaced with "n" because ticking area names cannot contain "-".
export function makeTickingAreaName(prefix, x, z) {
    const id = _tickingAreaCounter++;
    return `${prefix}_${Math.floor(x)}_${Math.floor(z)}_${id}`.replace(/-/g, "n");
}

export function trackArea(name) {
    const objective = world.scoreboard.getObjective(_OBJECTIVE_ID);
    // We use the ticking area name as a 'fake player' name
    // The score itself doesn't matter, we just need the entry to exist
    objective.setScore(name, 1);
    _activeAreas.add(name);
}

export function untrackArea(name) {
    const objective = world.scoreboard.getObjective(_OBJECTIVE_ID);
    objective.removeParticipant(name);
    _activeAreas.delete(name);
}

export function cleanupScoreboard() {
    const objective = world.scoreboard.getObjective(_OBJECTIVE_ID);
    const participants = objective.getParticipants();
    const overworld = world.getDimension("overworld");

    if (participants.length > 0) {
        console.warn(`[Cleanup] Found ${participants.length} ghost ticking areas.`);

        for (const participant of participants) {
            const areaName = participant.displayName;
            console.warn(areaName);
            

            // Try to remove the ticking area
            try {
                overworld.runCommand(`tickingarea remove ${areaName}`);
            } catch (e) {
                // It might already be gone, which is fine
            }

            // Remove from scoreboard tracker
            objective.removeParticipant(participant);
        }
        console.warn("[Cleanup] All ghost areas processed.");
    }
}

export function getActiveAreaCount() {
    return _activeAreas.size;
}