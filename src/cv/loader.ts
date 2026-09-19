/**
 * Loads OpenCV.js (served from /vendor, no CDN) as a classic script and
 * resolves once the WASM runtime is ready. Typed loosely: the OpenCV.js API
 * surface is huge and we only use a small, stable subset.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

let cvPromise: Promise<CV> | null = null;

export function loadOpenCV(): Promise<CV> {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise<CV>((resolve, reject) => {
    const w = window as unknown as { cv?: CV };
    const finish = () => {
      const mod = w.cv;
      if (!mod) return reject(new Error('OpenCV global missing after load'));
      if (typeof mod.then === 'function') {
        mod.then((m: CV) => resolve(m), reject);
      } else if (mod.Mat) {
        resolve(mod);
      } else {
        mod.onRuntimeInitialized = () => resolve(mod);
      }
    };
    if (w.cv) return finish();
    const s = document.createElement('script');
    s.src = `${import.meta.env.BASE_URL}vendor/opencv.js`;
    s.async = true;
    s.onload = finish;
    s.onerror = () => reject(new Error('Failed to load OpenCV.js'));
    document.head.appendChild(s);
  });
  return cvPromise;
}
