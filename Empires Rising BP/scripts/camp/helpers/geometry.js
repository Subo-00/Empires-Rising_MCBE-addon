import {
    RECT_DEPTH_RATIO,
    RECT_MIN_DEPTH,
    WALL_LAYER_SPACING,
} from "../../config/camp/configCamp.js";
import {
    int,
    key2,
    makeOdd,
} from "./smallHelpers.js";


export function bresenhamLine(x0, z0, x1, z1) {
    x0 = int(x0);
    z0 = int(z0);
    x1 = int(x1);
    z1 = int(z1);

    const points = [];
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;

    let err = dx - dz;
    let x = x0;
    let z = z0;

    while (true) {
        points.push({ x, z });
        if (x === x1 && z === z1) break;

        const e2 = err * 2;

        if (e2 > -dz) {
            err -= dz;
            x += sx;
        }

        if (e2 < dx) {
            err += dx;
            z += sz;
        }
    }

    return points;
}

export function uniquePoints(points) {
    const seen = new Set();
    const out = [];

    for (const p of points) {
        const x = int(p.x);
        const z = int(p.z);
        const k = key2(x, z);

        if (seen.has(k)) continue;

        seen.add(k);
        out.push({ x, z });
    }

    return out;
}

// Odd depth (in blocks) of a rectangle-shaped camp of the given diameter.
export function rectangleDepth(diameter) {
    return makeOdd(Math.max(RECT_MIN_DEPTH, Math.round(diameter * RECT_DEPTH_RATIO)));
}

// Half-extents of a plan's footprint from its center.
//   r     = radius along X (always diameter/2)
//   halfW = half-width  (X) including optional pad
//   halfD = half-depth  (Z) including optional pad; rectangles are shallower
export function getPlanHalfExtents(plan, pad = 0) {
    const r = Math.floor(plan.size.diameter / 2);
    const halfW = r + pad;
    const halfD = (plan.shape.key === "rectangle"
        ? Math.floor(rectangleDepth(plan.size.diameter) / 2)
        : r) + pad;
    return { r, halfW, halfD };
}

export function generateSquareWall(cx, cz, diameter) {
    const r = Math.floor(diameter / 2);
    const points = [];

    // North side: left to right
    for (let x = cx - r; x <= cx + r; x++) points.push({ x, z: cz - r });
    // East side: top to bottom
    for (let z = cz - r + 1; z <= cz + r - 1; z++) points.push({ x: cx + r, z });
    // South side: right to left
    for (let x = cx + r; x >= cx - r; x--) points.push({ x, z: cz + r });
    // West side: bottom to top
    for (let z = cz + r - 1; z >= cz - r + 1; z--) points.push({ x: cx - r, z });

    return uniquePoints(points);
}

export function generateRectangleWall(cx, cz, diameter, layerIndex = 0) {
    const shrink = layerIndex * WALL_LAYER_SPACING;
    const halfW = Math.floor(diameter / 2) - shrink;
    const halfD = Math.floor(rectangleDepth(diameter) / 2) - shrink;
    if (halfW < 2 || halfD < 2) return [];
    const points = [];

    // North side: left to right
    for (let x = cx - halfW; x <= cx + halfW; x++) points.push({ x, z: cz - halfD });
    // East side: top to bottom
    for (let z = cz - halfD + 1; z <= cz + halfD - 1; z++) points.push({ x: cx + halfW, z });
    // South side: right to left
    for (let x = cx + halfW; x >= cx - halfW; x--) points.push({ x, z: cz + halfD });
    // West side: bottom to top
    for (let z = cz + halfD - 1; z >= cz - halfD + 1; z--) points.push({ x: cx - halfW, z });

    return uniquePoints(points);
}

export function generateCircleWall(cx, cz, diameter) {
    const r = Math.floor(diameter / 2);
    const samples = Math.max(48, Math.ceil(2 * Math.PI * r * 1.6));
    const raw = [];

    for (let i = 0; i < samples; i++) {
        const a = (i / samples) * Math.PI * 2;
        raw.push({
            x: Math.round(cx + Math.cos(a) * r),
            z: Math.round(cz + Math.sin(a) * r),
        });
    }

    const points = [];

    for (let i = 0; i < raw.length; i++) {
        const a = raw[i];
        const b = raw[(i + 1) % raw.length];
        points.push(...bresenhamLine(a.x, a.z, b.x, b.z));
    }

    return uniquePoints(points);
}

export function generateWallPoints(shapeKey, cx, cz, diameter) {
    if (shapeKey === "square") return generateSquareWall(cx, cz, diameter);
    if (shapeKey === "rectangle") return generateRectangleWall(cx, cz, diameter);
    if (shapeKey === "circle") return generateCircleWall(cx, cz, diameter);
    return generateSquareWall(cx, cz, diameter);
}