import type { CV } from './loader';

/**
 * Variance of the Laplacian: a cheap, well-known focus measure. Higher means
 * crisper edges. Text pages in focus typically score well above 100 at
 * native resolution; motion blur or a missed focus drops it below ~40.
 */
export function laplacianVariance(cv: CV, img: ImageData): number {
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat();
  const lap = new cv.Mat();
  const mean = new cv.Mat();
  const std = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.Laplacian(gray, lap, cv.CV_64F);
    cv.meanStdDev(lap, mean, std);
    const s = std.data64F[0];
    return s * s;
  } finally {
    src.delete(); gray.delete(); lap.delete(); mean.delete(); std.delete();
  }
}

/** A page is considered in focus above this Laplacian variance. */
export const FOCUS_THRESHOLD = 45;

/**
 * Samples a native-resolution patch from the centre of the detected page so
 * the focus measure reflects what the OCR will actually see, not the
 * downscaled analysis frame.
 */
export function samplePatch(video: HTMLVideoElement, cx: number, cy: number, size = 360): ImageData {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const x = Math.max(0, Math.min(video.videoWidth - size, Math.round(cx - size / 2)));
  const y = Math.max(0, Math.min(video.videoHeight - size, Math.round(cy - size / 2)));
  ctx.drawImage(video, x, y, size, size, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

/** Centre crop of an ImageData, used to compare two candidate captures. */
export function centerCrop(img: ImageData, size = 600): ImageData {
  const w = Math.min(size, img.width);
  const h = Math.min(size, img.height);
  const x0 = Math.floor((img.width - w) / 2);
  const y0 = Math.floor((img.height - h) / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcOff = ((y0 + y) * img.width + x0) * 4;
    out.set(img.data.subarray(srcOff, srcOff + w * 4), y * w * 4);
  }
  return new ImageData(out, w, h);
}
