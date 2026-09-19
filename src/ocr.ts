import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

export type OcrLang = 'kor+eng' | 'eng' | 'kor';

export interface OcrResult {
  text: string;
  confidence: number;
  ms: number;
}

const base = import.meta.env.BASE_URL;

let workerPromise: Promise<Worker> | null = null;
let currentLang: OcrLang = 'kor+eng';
let progressListener: ((status: string, progress: number) => void) | null = null;

export function onOcrProgress(fn: typeof progressListener) {
  progressListener = fn;
}

/**
 * Creates (once) the Tesseract worker with the language models loaded from
 * the app's own origin. Call early so the first recognition is instant.
 */
export function preloadOcr(lang: OcrLang = currentLang): Promise<Worker> {
  if (workerPromise && lang === currentLang) return workerPromise;
  currentLang = lang;
  const old = workerPromise;
  workerPromise = (async () => {
    if (old) (await old).terminate().catch(() => {});
    const worker = await createWorker(lang.split('+'), OEM.LSTM_ONLY, {
      workerPath: `${base}vendor/tesseract/worker.min.js`,
      corePath: `${base}vendor/tesseract-core`,
      langPath: `${base}tessdata`,
      gzip: true,
      workerBlobURL: false,
      logger: (m) => progressListener?.(m.status, m.progress ?? 0),
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
    });
    return worker;
  })();
  return workerPromise;
}

export async function recognize(image: ImageData | HTMLCanvasElement | Blob): Promise<OcrResult> {
  const worker = await preloadOcr();
  const t0 = performance.now();
  const input = image instanceof ImageData ? imageDataToCanvas(image) : image;
  const { data } = await worker.recognize(input);
  return { text: cleanText(data.text), confidence: data.confidence, ms: Math.round(performance.now() - t0) };
}

export function imageDataToCanvas(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

/**
 * Tidies raw Tesseract output: trims trailing spaces, collapses runs of blank
 * lines, and removes the stray spaces Tesseract sometimes inserts between
 * adjacent Hangul syllables.
 */
export function cleanText(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([가-힣])\s(?=[가-힣][,.!?])/g, '$1')
    .trim();
}
