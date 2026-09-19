import { describe, expect, it } from 'vitest';
import {
  StabilityTracker,
  anchorEnds,
  buildRemap,
  edgePoint,
  fitCurvedQuad,
  fitQuadratic,
  isPlausiblePage,
  orderCorners,
  outputSize,
  type Quad,
} from '../../src/geometry';

const rect: Quad = [
  { x: 100, y: 100 },
  { x: 500, y: 100 },
  { x: 500, y: 700 },
  { x: 100, y: 700 },
];

describe('orderCorners', () => {
  it('orders shuffled points TL, TR, BR, BL', () => {
    const shuffled = [rect[2], rect[0], rect[3], rect[1]];
    expect(orderCorners(shuffled)).toEqual(rect);
  });
  it('handles a perspective-distorted page', () => {
    const q = orderCorners([
      { x: 480, y: 120 },
      { x: 90, y: 690 },
      { x: 130, y: 110 },
      { x: 520, y: 700 },
    ]);
    expect(q[0]).toEqual({ x: 130, y: 110 });
    expect(q[1]).toEqual({ x: 480, y: 120 });
    expect(q[2]).toEqual({ x: 520, y: 700 });
    expect(q[3]).toEqual({ x: 90, y: 690 });
  });
});

describe('isPlausiblePage', () => {
  it('accepts a large upright rectangle', () => {
    expect(isPlausiblePage(rect, 600, 800)).toBe(true);
  });
  it('rejects tiny or degenerate shapes', () => {
    const tiny: Quad = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    expect(isPlausiblePage(tiny, 600, 800)).toBe(false);
    const sliver: Quad = [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 30 },
      { x: 0, y: 30 },
    ];
    expect(isPlausiblePage(sliver, 600, 800)).toBe(false);
  });
});

describe('fitQuadratic', () => {
  it('recovers known coefficients', () => {
    const ts = Array.from({ length: 30 }, (_, i) => i / 29);
    const ds = ts.map((t) => 12 * t * t - 12 * t + 0.5);
    const [a, b, c] = fitQuadratic(ts, ds);
    expect(a).toBeCloseTo(12, 5);
    expect(b).toBeCloseTo(-12, 5);
    expect(c).toBeCloseTo(0.5, 5);
  });
  it('returns straight for too few samples', () => {
    expect(fitQuadratic([0, 1], [0, 0])).toEqual([0, 0, 0]);
  });
  it('anchorEnds makes the profile vanish at both corners', () => {
    const p = anchorEnds([-40, 3, 2]);
    expect(p[0] * 0 + p[1] * 0 + p[2]).toBe(0);
    expect(p[0] + p[1] + p[2]).toBeCloseTo(0);
  });
});

/** Builds a dense outline of a page whose top/bottom edges sag by `bulge` px at the middle. */
function curvedOutline(q: Quad, bulge: number, n = 200) {
  const [tl, tr, br, bl] = q;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const sag = -4 * bulge * t * (t - 1); // 0 at ends, bulge at the middle
    pts.push({ x: tl.x + (tr.x - tl.x) * t, y: tl.y + sag }); // top edge bends down into the page
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: tr.x, y: tr.y + (br.y - tr.y) * t });
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const sag = -4 * bulge * t * (t - 1);
    pts.push({ x: br.x + (bl.x - br.x) * t, y: br.y - sag }); // bottom edge bends up into the page
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({ x: bl.x, y: bl.y + (tl.y - bl.y) * t });
  }
  return pts;
}

describe('fitCurvedQuad + remap', () => {
  it('fits the bulge of a bent page and the remap follows the curved edges', () => {
    const bulge = 40;
    const cq = fitCurvedQuad(rect, curvedOutline(rect, bulge));
    // Middle of the top edge should be displaced by ~bulge px into the page (+y).
    const midTop = edgePoint(rect[0], rect[1], cq.top, 0.5, 1);
    expect(midTop.y).toBeCloseTo(100 + bulge, 0);
    // Middle of the bottom edge should be displaced ~bulge px up (-y).
    const midBot = edgePoint(rect[3], rect[2], cq.bottom, 0.5, -1);
    expect(midBot.y).toBeCloseTo(700 - bulge, 0);

    const { width, height } = outputSize(cq);
    expect(width).toBe(400);
    expect(height).toBe(600);
    const { mapX, mapY } = buildRemap(cq, width, height, 0);
    // Output corners map to the source corners.
    expect(mapX[0]).toBeCloseTo(100);
    expect(mapY[0]).toBeCloseTo(100);
    expect(mapX[width - 1]).toBeCloseTo(500);
    expect(mapY[(height - 1) * width + width - 1]).toBeCloseTo(700);
    // Output top-middle samples the sagged source point.
    const midX = Math.floor(width / 2);
    expect(mapY[midX]).toBeCloseTo(100 + bulge, 0);
    expect(mapY[(height - 1) * width + midX]).toBeCloseTo(700 - bulge, 0);
    // Output centre maps to source centre.
    expect(Math.abs(mapX[Math.floor(height / 2) * width + midX] - 300)).toBeLessThan(1);
    expect(Math.abs(mapY[Math.floor(height / 2) * width + midX] - 400)).toBeLessThan(1);
  });

  it('yields a straight profile for a flat page', () => {
    const cq = fitCurvedQuad(rect, curvedOutline(rect, 0));
    expect(Math.abs(cq.top[0])).toBeLessThan(1e-6);
    expect(Math.abs(cq.bottom[0])).toBeLessThan(1e-6);
  });
});

describe('StabilityTracker', () => {
  const jitter = (q: Quad, d: number): Quad => q.map((p) => ({ x: p.x + d, y: p.y - d })) as Quad;

  it('reaches full progress only after the page holds still', () => {
    const t = new StabilityTracker(600, 5);
    let p = 0;
    for (let i = 0; i < 5; i++) p = t.push(jitter(rect, i % 2));
    expect(p).toBe(1);
    expect(t.shouldCapture(p, rect)).toBe(true);
    t.markCaptured(rect);
    // Same page again → do not re-capture.
    for (let i = 0; i < 5; i++) p = t.push(rect);
    expect(t.shouldCapture(p, rect)).toBe(false);
  });

  it('resets when the page moves or disappears', () => {
    const t = new StabilityTracker(600, 5);
    for (let i = 0; i < 4; i++) t.push(rect);
    expect(t.push(jitter(rect, 60))).toBeLessThan(1);
    expect(t.push(null)).toBe(0);
  });

  it('re-arms after the page is turned', () => {
    const t = new StabilityTracker(600, 3);
    t.markCaptured(rect);
    t.push(null);
    let p = 0;
    for (let i = 0; i < 3; i++) p = t.push(rect);
    expect(t.shouldCapture(p, rect)).toBe(true);
  });
});
