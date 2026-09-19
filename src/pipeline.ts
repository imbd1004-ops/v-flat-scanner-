import { ANALYSIS_WIDTH, detectPage, type Detection } from './cv/detect';
import { dewarp } from './cv/dewarp';
import { enhanceForOcr } from './cv/enhance';
import type { CV } from './cv/loader';
import { STRAIGHT, type CurvedQuad } from './geometry';
import { downscale } from './image';
import { recognize, type OcrResult } from './ocr';

export interface ScanOutput {
  /** Flattened colour page. */
  flat: ImageData;
  /** OCR-ready enhanced version. */
  enhanced: ImageData;
  ocr: OcrResult;
  /** Whether a page outline was found (otherwise the whole image was used). */
  pageFound: boolean;
  timings: { detect: number; dewarp: number; enhance: number; ocr: number };
}

export type StageListener = (stage: 'detect' | 'dewarp' | 'enhance' | 'ocr', detail?: string) => void;

/**
 * Runs the whole pipeline on a full-resolution frame. When a detection from
 * the live preview is supplied it is reused; otherwise the frame is analysed.
 */
export async function processFrame(
  cv: CV,
  frame: ImageData,
  onStage: StageListener = () => {},
  known?: Detection | null,
): Promise<ScanOutput> {
  onStage('detect');
  const t0 = performance.now();
  let det = known ?? null;
  if (!det) {
    const { data, scale } = downscale(frame, Math.min(ANALYSIS_WIDTH, frame.width));
    det = detectPage(cv, data, scale);
  }
  const t1 = performance.now();

  onStage('dewarp');
  let page: CurvedQuad;
  let scale: number;
  if (det) {
    page = det.page;
    scale = det.scale;
  } else {
    // No outline: treat the full frame as the page.
    page = {
      corners: [
        { x: 0, y: 0 },
        { x: frame.width - 1, y: 0 },
        { x: frame.width - 1, y: frame.height - 1 },
        { x: 0, y: frame.height - 1 },
      ],
      top: STRAIGHT,
      bottom: STRAIGHT,
    };
    scale = 1;
  }
  const flat = dewarp(cv, frame, page, scale);
  const t2 = performance.now();

  onStage('enhance');
  const enhanced = enhanceForOcr(cv, flat);
  const t3 = performance.now();

  onStage('ocr');
  const ocr = await recognize(enhanced);
  const t4 = performance.now();

  return {
    flat,
    enhanced,
    ocr,
    pageFound: !!det,
    timings: {
      detect: Math.round(t1 - t0),
      dewarp: Math.round(t2 - t1),
      enhance: Math.round(t3 - t2),
      ocr: Math.round(t4 - t3),
    },
  };
}
