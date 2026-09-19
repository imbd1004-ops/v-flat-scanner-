import type { CV } from './loader';
import { type CurvedQuad, buildRemap, outputSize, scaleCurvedQuad } from '../geometry';

/** Longest side of the flattened page; keeps OCR fast on phones. */
export const MAX_OUTPUT_SIDE = 2000;

/**
 * Flattens the page described by `page` (in analysis coordinates, scaled by
 * `scale` to reach the source image) and returns the result as ImageData.
 */
export function dewarp(cv: CV, source: ImageData, page: CurvedQuad, scale: number): ImageData {
  const full = scaleCurvedQuad(page, scale);
  let { width, height } = outputSize(full);
  const longest = Math.max(width, height);
  if (longest > MAX_OUTPUT_SIDE) {
    const f = MAX_OUTPUT_SIDE / longest;
    width = Math.round(width * f);
    height = Math.round(height * f);
  }
  const { mapX, mapY } = buildRemap(full, width, height);

  const src = cv.matFromImageData(source);
  const mx = cv.matFromArray(height, width, cv.CV_32FC1, mapX);
  const my = cv.matFromArray(height, width, cv.CV_32FC1, mapY);
  const dst = new cv.Mat();
  try {
    cv.remap(src, dst, mx, my, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    return new ImageData(new Uint8ClampedArray(dst.data), dst.cols, dst.rows);
  } finally {
    src.delete(); mx.delete(); my.delete(); dst.delete();
  }
}
