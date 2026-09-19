import { describe, expect, it } from 'vitest';
import { centerCrop } from '../../src/cv/sharpness';

describe('centerCrop', () => {
  it('extracts the centre region with intact pixel rows', () => {
    const w = 10, h = 8;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = x; data[i + 1] = y; data[i + 3] = 255; }
    const img = { width: w, height: h, data } as ImageData;
    const out = centerCrop(img, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    // top-left of the crop should be source pixel (3,2)
    expect(out.data[0]).toBe(3);
    expect(out.data[1]).toBe(2);
    // bottom-right should be (6,5)
    const last = (3 * 4 + 3) * 4;
    expect(out.data[last]).toBe(6);
    expect(out.data[last + 1]).toBe(5);
  });
  it('clamps to the image size', () => {
    const img = { width: 3, height: 2, data: new Uint8ClampedArray(3 * 2 * 4) } as ImageData;
    const out = centerCrop(img, 100);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
  });
});
