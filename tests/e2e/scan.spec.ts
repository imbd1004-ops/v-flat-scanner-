import { expect, test } from '@playwright/test';
import { KOREAN_LINES, SAMPLE_LINES, renderCurvedPage } from './synthetic-page';

test.describe('V-Flat Scanner', () => {
  test('loads engines, flattens a curved page and recognises its text', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.locator('#setup-status')).toHaveText(/준비 완료/, { timeout: 120_000 });
    await expect(page.locator('#start')).toBeEnabled();

    const png = await renderCurvedPage(page, { bulge: 70 });
    await page.locator('#file-setup').setInputFiles({ name: 'book.png', mimeType: 'image/png', buffer: png });

    await expect(page.locator('#result')).toHaveClass(/active/, { timeout: 120_000 });
    await expect(page.locator('#result-meta')).toContainText('페이지 감지·평탄화됨');

    const text = await page.locator('#result-text').inputValue();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ');
    const got = norm(text);
    // Every sample line must come out nearly intact from the flattened page.
    let matched = 0;
    for (const line of SAMPLE_LINES) {
      const words = norm(line).split(' ').filter((w) => w.length > 3);
      const hits = words.filter((w) => got.includes(w)).length;
      if (hits / words.length >= 0.8) matched++;
    }
    expect(matched, `recognised text:\n${text}`).toBeGreaterThanOrEqual(SAMPLE_LINES.length - 1);
    // Korean: the second line must be recognised verbatim (spaces ignored).
    const hangul = text.replace(/\s+/g, '');
    expect(hangul, `recognised text:\n${text}`).toContain(KOREAN_LINES[1].replace(/\s+/g, ''));

    // The flattened image should be close to the page's own aspect ratio.
    const img = page.locator('#result-img');
    const size = await img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
    expect(size.w / size.h).toBeGreaterThan(0.6);
    expect(size.w / size.h).toBeLessThan(0.85);

    // History keeps the scan.
    await page.locator('#back-scan').click();
    await page.locator('#to-history').click();
    await expect(page.locator('#history .card')).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('falls back to the whole image when no page outline is found', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#setup-status')).toHaveText(/준비 완료/, { timeout: 120_000 });
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 800; c.height = 400;
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 400);
      x.fillStyle = '#000'; x.font = '600 40px "DejaVu Sans", Arial, sans-serif';
      x.fillText('Hello flat world', 60, 200);
      return c.toDataURL('image/png');
    });
    await page.locator('#file-setup').setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
    await expect(page.locator('#result')).toHaveClass(/active/, { timeout: 120_000 });
    await expect(page.locator('#result-meta')).toContainText('전체 이미지 사용');
    await expect(page.locator('#result-text')).toHaveValue(/Hello.*world/i);
  });
});
