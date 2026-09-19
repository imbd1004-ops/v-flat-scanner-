/**
 * Pure geometry helpers (no OpenCV dependency) so they can be unit-tested in Node.
 *
 * The page is modelled as a "curved quad": four corners plus a quadratic
 * bulge profile along the top and bottom edges. That is enough to describe a
 * book page whose outline bends near the spine, which is what makes text lines
 * curve in a hand-held photo.
 */

export interface Point {
  x: number;
  y: number;
}

/** Top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/**
 * A page outline: 4 corners plus a perpendicular offset profile for the top
 * and bottom edges, expressed as quadratic coefficients d(t) = a·t² + b·t + c,
 * t ∈ [0, 1] along the edge (TL→TR for top, BL→BR for bottom). d is measured
 * along the edge's outward normal in pixels.
 */
export interface CurvedQuad {
  corners: Quad;
  top: [number, number, number];
  bottom: [number, number, number];
}

export const STRAIGHT: [number, number, number] = [0, 0, 0];

export function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Orders 4 arbitrary points into TL, TR, BR, BL.
 * Uses sum/difference heuristic which is robust for convex quads that are not
 * rotated by more than ~45°.
 */
export function orderCorners(pts: Point[]): Quad {
  if (pts.length !== 4) throw new Error('orderCorners expects 4 points');
  const bySum = [...pts].sort((p, q) => p.x + p.y - (q.x + q.y));
  const tl = bySum[0];
  const br = bySum[3];
  const rest = pts.filter((p) => p !== tl && p !== br);
  const byDiff = rest.sort((p, q) => p.x - p.y - (q.x - q.y));
  const bl = byDiff[0];
  const tr = byDiff[1];
  return [tl, tr, br, bl];
}

/** Shoelace polygon area. */
export function polygonArea(pts: Point[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Interior angle at vertex b (degrees). */
function angleAt(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * Sanity check for a page candidate: reasonable size relative to the frame,
 * not a sliver, corners roughly rectangular (a real page seen at an angle
 * still has interior angles well within 50°–130°).
 */
export function isPlausiblePage(q: Quad, frameW: number, frameH: number): boolean {
  const area = polygonArea(q);
  if (area < 0.12 * frameW * frameH) return false;
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  if (w < 40 || h < 40) return false;
  const ratio = w / h;
  if (ratio < 0.25 || ratio > 4) return false;
  for (let i = 0; i < 4; i++) {
    const ang = angleAt(q[(i + 3) % 4], q[i], q[(i + 1) % 4]);
    if (ang < 50 || ang > 130) return false;
  }
  return true;
}

/**
 * Least-squares fit of d = a·t² + b·t + c.
 * Returns STRAIGHT when there are too few samples to fit reliably.
 */
export function fitQuadratic(ts: number[], ds: number[]): [number, number, number] {
  const n = ts.length;
  if (n < 6) return STRAIGHT;
  // Normal equations for a 3-parameter polynomial.
  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let r0 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    const d = ds[i];
    const t2 = t * t;
    s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2;
    r0 += d; r1 += d * t; r2 += d * t2;
  }
  // Solve [s4 s3 s2; s3 s2 s1; s2 s1 s0] [a b c]^T = [r2 r1 r0]^T via Cramer's rule.
  const det = (m: number[]) =>
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const M = [s4, s3, s2, s3, s2, s1, s2, s1, s0];
  const D = det(M);
  if (Math.abs(D) < 1e-9) return STRAIGHT;
  const Da = det([r2, s3, s2, r1, s2, s1, r0, s1, s0]);
  const Db = det([s4, r2, s2, s3, r1, s1, s2, r0, s0]);
  const Dc = det([s4, s3, r2, s3, s2, r1, s2, s1, r0]);
  return [Da / D, Db / D, Dc / D];
}

/**
 * Splits an outline (dense contour points, any order/direction) into the
 * samples that belong to the top and bottom edges of the quad and fits a
 * bulge profile for each. Points closer to the left/right edges are ignored
 * (those edges are treated as straight).
 */
export function fitCurvedQuad(corners: Quad, outline: Point[]): CurvedQuad {
  const [tl, tr, br, bl] = corners;
  const edges: [Point, Point][] = [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];

  const topT: number[] = [], topD: number[] = [];
  const botT: number[] = [], botD: number[] = [];

  for (const p of outline) {
    // assign to nearest edge segment
    let best = -1, bestDist = Infinity, bestT = 0, bestSigned = 0;
    for (let e = 0; e < 4; e++) {
      const [a, b] = edges[e];
      const { t, distance, signed } = projectOnSegment(p, a, b);
      if (distance < bestDist) {
        bestDist = distance; best = e; bestT = t; bestSigned = signed;
      }
    }
    if (best === 0) {
      // Top edge, measured along the left normal of TL→TR (= +y, i.e. into the page).
      topT.push(bestT); topD.push(bestSigned);
    } else if (best === 2) {
      // Bottom edge is BR→BL here; its left normal is -y (into the page).
      // Re-parametrise to BL→BR so t runs left→right like the top edge.
      botT.push(1 - bestT); botD.push(bestSigned);
    }
  }

  // Ignore samples that sit right at the corners (they are noisy and
  // dominated by the adjacent straight edge).
  const trim = (ts: number[], ds: number[]) => {
    const T: number[] = [], D: number[] = [];
    for (let i = 0; i < ts.length; i++) if (ts[i] > 0.03 && ts[i] < 0.97) { T.push(ts[i]); D.push(ds[i]); }
    return [T, D] as const;
  };
  const [tT, tD] = trim(topT, topD);
  const [bT, bD] = trim(botT, botD);

  let top = fitQuadratic(tT, tD);
  let bottom = fitQuadratic(bT, bD);

  // A fitted profile should vanish at the corners by construction; enforce it
  // softly so tiny fitting errors do not shift the corners.
  top = anchorEnds(top);
  bottom = anchorEnds(bottom);

  // Reject absurd bulges (> 35% of the edge length) as detection noise.
  const topLen = dist(tl, tr);
  const botLen = dist(bl, br);
  if (maxAbsProfile(top) > 0.35 * topLen) top = STRAIGHT;
  if (maxAbsProfile(bottom) > 0.35 * botLen) bottom = STRAIGHT;

  return { corners, top, bottom };
}

/** Returns t (0..1 along a→b, clamped), distance to the segment, and signed offset (left of a→b positive). */
export function projectOnSegment(p: Point, a: Point, b: Point) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * vx, cy = a.y + t * vy;
  const distance = Math.hypot(p.x - cx, p.y - cy);
  const len = Math.sqrt(len2);
  // cross product sign: positive when p is to the left of a→b (in y-down image coords "left" is towards -y for a horizontal edge)
  const signed = (vx * (p.y - a.y) - vy * (p.x - a.x)) / len;
  return { t, distance, signed };
}

/** Modify [a,b,c] so that d(0)=0 and d(1)=0, keeping the curvature term. */
export function anchorEnds([a]: [number, number, number]): [number, number, number] {
  // d(t) = a t² + b t + c with d(0)=0 → c=0, d(1)=0 → b = -a
  return [a, -a, 0];
}

export function evalProfile(p: [number, number, number], t: number): number {
  return p[0] * t * t + p[1] * t + p[2];
}

export function maxAbsProfile(p: [number, number, number]): number {
  let m = 0;
  for (let i = 0; i <= 20; i++) m = Math.max(m, Math.abs(evalProfile(p, i / 20)));
  return m;
}

/**
 * Point on the (possibly curved) top or bottom edge at parameter t.
 * `normalSign` selects which side of a→b the profile is applied to: +1 uses
 * the left normal of a→b (for the top edge TL→TR that is "into the page"),
 * -1 the right normal (for the bottom edge BL→BR, again "into the page").
 */
export function edgePoint(a: Point, b: Point, profile: [number, number, number], t: number, normalSign: number): Point {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  const nx = -vy / len, ny = vx / len;
  const d = evalProfile(profile, t) * normalSign;
  return { x: a.x + t * vx + nx * d, y: a.y + t * vy + ny * d };
}

/** Sampled polyline of an edge, useful for drawing the overlay. */
export function sampleEdge(a: Point, b: Point, profile: [number, number, number], normalSign: number, n = 24): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) pts.push(edgePoint(a, b, profile, i / n, normalSign));
  return pts;
}

/** Full outline polyline of a curved quad (clockwise from TL). */
export function curvedOutline(cq: CurvedQuad, n = 24): Point[] {
  const [tl, tr, br, bl] = cq.corners;
  const top = sampleEdge(tl, tr, cq.top, 1, n);
  const bottom = sampleEdge(bl, br, cq.bottom, -1, n).reverse();
  return [...top, ...bottom];
}

/** Output size for the flattened page, in pixels. */
export function outputSize(cq: CurvedQuad): { width: number; height: number } {
  const [tl, tr, br, bl] = cq.corners;
  const width = Math.round((dist(tl, tr) + dist(bl, br)) / 2);
  const height = Math.round((dist(tl, bl) + dist(tr, br)) / 2);
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/**
 * Builds the inverse mapping used by cv.remap: for every output pixel (u,v)
 * returns the source coordinate. Output row v is interpolated between the
 * top and bottom curves at the same horizontal fraction, so a bent page is
 * straightened column by column.
 */
export function buildRemap(
  cq: CurvedQuad,
  width: number,
  height: number,
  /** Fraction trimmed from every side so the detected edge itself (and any dark background touching it) is left out. */
  inset = 0.006,
): { mapX: Float32Array; mapY: Float32Array } {
  const [tl, tr, br, bl] = cq.corners;
  const mapX = new Float32Array(width * height);
  const mapY = new Float32Array(width * height);
  const topPts = new Float64Array(width * 2);
  const botPts = new Float64Array(width * 2);
  const span = 1 - 2 * inset;
  for (let x = 0; x < width; x++) {
    const u = inset + span * (width === 1 ? 0 : x / (width - 1));
    const tp = edgePoint(tl, tr, cq.top, u, 1);
    const bp = edgePoint(bl, br, cq.bottom, u, -1);
    topPts[x * 2] = tp.x; topPts[x * 2 + 1] = tp.y;
    botPts[x * 2] = bp.x; botPts[x * 2 + 1] = bp.y;
  }
  for (let y = 0; y < height; y++) {
    const v = inset + span * (height === 1 ? 0 : y / (height - 1));
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const tx = topPts[x * 2], ty = topPts[x * 2 + 1];
      const bx = botPts[x * 2], by = botPts[x * 2 + 1];
      mapX[row + x] = tx + (bx - tx) * v;
      mapY[row + x] = ty + (by - ty) * v;
    }
  }
  return { mapX, mapY };
}

export function scaleCurvedQuad(cq: CurvedQuad, s: number): CurvedQuad {
  const sc = (p: Point): Point => ({ x: p.x * s, y: p.y * s });
  return {
    corners: [sc(cq.corners[0]), sc(cq.corners[1]), sc(cq.corners[2]), sc(cq.corners[3])],
    top: [cq.top[0] * s, cq.top[1] * s, cq.top[2] * s],
    bottom: [cq.bottom[0] * s, cq.bottom[1] * s, cq.bottom[2] * s],
  };
}

/**
 * Tracks the detected quad over consecutive frames and reports when the page
 * has been held still long enough to auto-capture (like a hands-free scanner).
 */
export class StabilityTracker {
  private history: Quad[] = [];
  private lastCaptureQuad: Quad | null = null;

  constructor(
    private readonly frameWidth: number,
    private readonly requiredFrames = 10,
    private readonly maxJitterFraction = 0.012,
  ) {}

  /** Push a detection (or null when no page was found). Returns progress 0..1. */
  push(q: Quad | null): number {
    if (!q) {
      this.history = [];
      // a lost page re-arms capture
      this.lastCaptureQuad = null;
      return 0;
    }
    this.history.push(q);
    if (this.history.length > this.requiredFrames) this.history.shift();
    const tol = this.maxJitterFraction * this.frameWidth;
    // Compare every frame in the window to the newest one.
    let stableCount = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (maxCornerDelta(this.history[i], q) <= tol) stableCount++;
      else break;
    }
    return Math.min(1, stableCount / this.requiredFrames);
  }

  /** True when the page is stable and differs from the one already captured. */
  shouldCapture(progress: number, q: Quad | null): boolean {
    if (progress < 1 || !q) return false;
    if (this.lastCaptureQuad && maxCornerDelta(this.lastCaptureQuad, q) <= 0.08 * this.frameWidth) return false;
    return true;
  }

  markCaptured(q: Quad) {
    this.lastCaptureQuad = q;
    this.history = [];
  }

  reset() {
    this.history = [];
    this.lastCaptureQuad = null;
  }
}

export function maxCornerDelta(a: Quad, b: Quad): number {
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, dist(a[i], b[i]));
  return m;
}
