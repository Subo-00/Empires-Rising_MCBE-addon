import {
    REGION_SIZE,
    REGION_BORDER_PADDING,
} from "../../config/camp/configCamp.js";


// Same size in blocks, used for random position math.
const REGION_SIZE_BLOCKS = REGION_SIZE * 16;

// Converts any chunk coordinate to the top-left chunk origin of its region.
// Exported so main.js can use it to map player chunk position → region.
export function getRegionOrigin(chunkX, chunkZ) {
    return {
        regionX: Math.floor(chunkX / REGION_SIZE) * REGION_SIZE,
        regionZ: Math.floor(chunkZ / REGION_SIZE) * REGION_SIZE,
    };
}

// Returns the center block (x, z) of a region.
// regionX / regionZ are the region origins in CHUNK coordinates.
// The center block is used as the location for the permanent core marker.
export function getRegionCenterBlock(regionX, regionZ) {
    const centerChunkX = regionX + Math.floor(REGION_SIZE / 2);
    const centerChunkZ = regionZ + Math.floor(REGION_SIZE / 2);
    return {
        x: centerChunkX * 16 + 8,
        z: centerChunkZ * 16 + 8,
    };
}

// Returns one random block position (x, z) inside the region,
// inset by REGION_BORDER_PADDING blocks on all four sides.
// This guarantees a village centered here can never overlap into a neighboring region,
// as long as the village radius never exceeds REGION_BORDER_PADDING.
export function randomPositionInRegion(regionX, regionZ) {
    const minX = regionX * 16 + REGION_BORDER_PADDING;
    const minZ = regionZ * 16 + REGION_BORDER_PADDING;
    const maxX = regionX * 16 + REGION_SIZE_BLOCKS - REGION_BORDER_PADDING;
    const maxZ = regionZ * 16 + REGION_SIZE_BLOCKS - REGION_BORDER_PADDING;

    return {
        x: Math.floor(minX + Math.random() * (maxX - minX)),
        z: Math.floor(minZ + Math.random() * (maxZ - minZ)),
    };
}

// Builds a batch of `count` random positions, trying to pick positions in
// different chunks so the batch checks are spread across the region rather
// than clustering in the same chunk (which would waste ticking area slots).
export function randomBatchPositionsInRegion(regionX, regionZ, count) {
    const positions = [];
    const usedChunkKeys = new Set();
    let safety = 0;

    while (positions.length < count && safety < count * 20) {
        safety++;
        const pos = randomPositionInRegion(regionX, regionZ);
        const chunkKey = `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`;
        if (usedChunkKeys.has(chunkKey)) continue;
        usedChunkKeys.add(chunkKey);
        positions.push(pos);
    }

    // Fallback: if we couldn't find enough unique chunks (very small region),
    // just fill the rest with any random position.
    while (positions.length < count) {
        positions.push(randomPositionInRegion(regionX, regionZ));
    }

    return positions;
}