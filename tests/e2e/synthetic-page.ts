import type { Page } from '@playwright/test';

export const SAMPLE_LINES = [
  'The quick brown fox jumps over',
  'the lazy dog. Scanning a book',
  'should be as simple as pointing',
  'the camera at the page and',
  'waiting a moment. Curved pages',
  'are flattened before the text',
  'is recognised on the device.',
  'Portable, private and fast.',
];
export const KOREAN_LINES = ['책을 바닥에 두고 카메라를 대면', '페이지가 자동으로 평평해집니다.'];

/**
 * Renders a photo-like image of an open book page whose top and bottom edges
 * bulge towards the middle (as when the spine keeps the page from lying flat)
 * and whose text lines follow the same curve. Returns a PNG buffer.
 */
export async function renderCurvedPage(page: Page, opts: { bulge?: number; width?: number; height?: number } = {}): Promise<Buffer> {
  const { bulge = 70, width = 1400, height = 1800 } = opts;
  const dataUrl = await page.evaluate(
    ({ bulge, width, height, lines, korean }) => {
      // 1) flat page with text
      const pw = 900, ph = 1250;
      const flat = document.createElement('canvas');
      flat.width = pw; flat.height = ph;
      const f = flat.getContext('2d')!;
      f.fillStyle = '#f7f5ef';
      f.fillRect(0, 0, pw, ph);
      f.fillStyle = '#1a1a1a';
      f.font = '600 34px "DejaVu Sans", "Liberation Sans", Arial, sans-serif';
      f.textBaseline = 'top';
      lines.forEach((l, i) => f.fillText(l, 70, 140 + i * 70));
      f.font = '400 34px "WenQuanYi Zen Hei", "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif';
      korean.forEach((l, i) => f.fillText(l, 70, 160 + (lines.length + i) * 70));
      f.font = '400 22px "DejaVu Sans", Arial, sans-serif';
      f.fillText('— 12 —', pw / 2 - 40, ph - 90);

      // 2) place it on a dark desk with a vertical bulge per column
      const out = document.createElement('canvas');
      out.width = width; out.height = height;
      const o = out.getContext('2d')!;
      const g = o.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#3a3128'); g.addColorStop(1, '#221b14');
      o.fillStyle = g;
      o.fillRect(0, 0, width, height);
      const left = (width - pw) / 2, top = (height - ph) / 2;
      for (let x = 0; x < pw; x++) {
        const u = x / (pw - 1);
        const sag = bulge * 4 * u * (1 - u);
        const y0 = top + sag, y1 = top + ph - sag;
        o.drawImage(flat, x, 0, 1, ph, left + x, y0, 1, y1 - y0);
      }
      // soft shading near the middle like a real spine shadow
      const sh = o.createLinearGradient(left, 0, left + pw, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.5, 'rgba(0,0,0,0.12)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      o.fillStyle = sh;
      o.fillRect(left, top, pw, ph);
      return out.toDataURL('image/png');
    },
    { bulge, width, height, lines: SAMPLE_LINES, korean: KOREAN_LINES },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}
