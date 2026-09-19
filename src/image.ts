/** Canvas/ImageData helpers shared by the UI and the pipeline. */

export function downscale(src: ImageData | HTMLVideoElement | HTMLImageElement, targetWidth: number): { data: ImageData; scale: number } {
  const srcW = src instanceof ImageData ? src.width : src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const srcH = src instanceof ImageData ? src.height : src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  const scale = srcW / targetWidth;
  const w = targetWidth;
  const h = Math.round(srcH / scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (src instanceof ImageData) {
    const tmp = document.createElement('canvas');
    tmp.width = srcW;
    tmp.height = srcH;
    tmp.getContext('2d')!.putImageData(src, 0, 0);
    ctx.drawImage(tmp, 0, 0, w, h);
  } else {
    ctx.drawImage(src, 0, 0, w, h);
  }
  return { data: ctx.getImageData(0, 0, w, h), scale };
}

export async function fileToImageData(file: Blob, maxSide = 3000): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  const f = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * f);
  c.height = Math.round(bmp.height * f);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height);
}

export function imageDataToBlob(img: ImageData, type = 'image/jpeg', quality = 0.85, maxSide = Infinity): Promise<Blob> {
  const f = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * f));
  c.height = Math.max(1, Math.round(img.height * f));
  const ctx = c.getContext('2d')!;
  if (f === 1) {
    ctx.putImageData(img, 0, 0);
  } else {
    const tmp = document.createElement('canvas');
    tmp.width = img.width;
    tmp.height = img.height;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    ctx.drawImage(tmp, 0, 0, c.width, c.height);
  }
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality));
}
