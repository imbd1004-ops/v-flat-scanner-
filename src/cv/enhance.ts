import type { CV } from './loader';

/**
 * Produces a clean, high-contrast grayscale image for OCR: local contrast
 * normalisation removes the shading gradient a bent page always has, and a
 * gentle sharpen makes thin Hangul strokes survive downscaling.
 */
export function enhanceForOcr(cv: CV, img: ImageData): ImageData {
  const src = cv.matFromImageData(img);
  const gray = new cv.Mat();
  const bg = new cv.Mat();
  const norm = new cv.Mat();
  const sharp = new cv.Mat();
  const rgba = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Estimate the paper background with a large blur and divide it out,
    // which flattens uneven lighting (shadow near the spine etc.).
    const k = Math.max(31, (Math.round(Math.min(img.width, img.height) / 20) | 1));
    cv.GaussianBlur(gray, bg, new cv.Size(k, k), 0);
    const grayF = new cv.Mat();
    const bgF = new cv.Mat();
    gray.convertTo(grayF, cv.CV_32F);
    bg.convertTo(bgF, cv.CV_32F, 1, 1);
    cv.divide(grayF, bgF, norm, 255);
    norm.convertTo(norm, cv.CV_8U);
    grayF.delete(); bgF.delete();

    // Unsharp mask
    const blurred = new cv.Mat();
    cv.GaussianBlur(norm, blurred, new cv.Size(0, 0), 1.2);
    cv.addWeighted(norm, 1.6, blurred, -0.6, 0, sharp);
    blurred.delete();

    cv.cvtColor(sharp, rgba, cv.COLOR_GRAY2RGBA);
    return new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
  } finally {
    src.delete(); gray.delete(); bg.delete(); norm.delete(); sharp.delete(); rgba.delete();
  }
}
