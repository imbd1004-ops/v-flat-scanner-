import type { CV } from './loader';
import {
  type CurvedQuad,
  type Point,
  type Quad,
  fitCurvedQuad,
  isPlausiblePage,
  orderCorners,
  polygonArea,
} from '../geometry';

export interface Detection {
  /** In the coordinate space of the analysed (downscaled) image. */
  page: CurvedQuad;
  /** Scale factor from analysed image to the source image. */
  scale: number;
  width: number;
  height: number;
}

/** Width the live preview frames are downscaled to before analysis. */
export const ANALYSIS_WIDTH = 360;

/**
 * Finds the page outline in an RGBA ImageData.
 * Pipeline: gray → blur → Canny (+ adaptive threshold fallback) → close →
 * largest plausible contour → convex hull → 4-corner approximation → curve fit.
 */
export function detectPage(cv: CV, img: ImageData, scale: number): Detection | null {
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

    // Edge map: Canny catches the page border against most backgrounds;
    // the bright-region mask helps when the page sits on a similar-toned desk.
    cv.Canny(blur, edges, 40, 120);
    const bright = new cv.Mat();
    cv.adaptiveThreshold(blur, bright, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 51, -8);
    const brightEdges = new cv.Mat();
    cv.morphologyEx(bright, brightEdges, cv.MORPH_GRADIENT, kernel);
    cv.bitwise_or(edges, brightEdges, edges);
    bright.delete();
    brightEdges.delete();

    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const frameArea = img.width * img.height;
    let best: { quad: Quad; outline: Point[]; area: number } | null = null;

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < 0.12 * frameArea || (best && area <= best.area)) {
        c.delete();
        continue;
      }
      const hull = new cv.Mat();
      cv.convexHull(c, hull, false, true);
      const peri = cv.arcLength(hull, true);
      const approx = new cv.Mat();
      let quad: Quad | null = null;
      for (let eps = 0.015; eps <= 0.12 && !quad; eps += 0.01) {
        cv.approxPolyDP(hull, approx, eps * peri, true);
        if (approx.rows === 4) {
          const pts: Point[] = [];
          for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2], y: approx.data32S[k * 2 + 1] });
          const q = orderCorners(pts);
          if (isPlausiblePage(q, img.width, img.height) && polygonArea(q) > 0.6 * area) quad = q;
        }
      }
      if (quad) {
        const outline: Point[] = [];
        for (let k = 0; k < c.rows; k++) outline.push({ x: c.data32S[k * 2], y: c.data32S[k * 2 + 1] });
        best = { quad, outline, area };
      }
      approx.delete();
      hull.delete();
      c.delete();
    }

    if (!best) return null;
    const page = fitCurvedQuad(best.quad, densify(best.outline));
    return { page, scale, width: img.width, height: img.height };
  } finally {
    src.delete(); gray.delete(); blur.delete(); edges.delete(); kernel.delete();
    contours.delete(); hierarchy.delete();
  }
}

/**
 * CHAIN_APPROX_SIMPLE drops collinear points, so re-sample the polyline with
 * ~4px spacing to give the curve fit an even distribution of samples.
 */
function densify(poly: Point[], step = 4): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
