// Copies the heavy runtime assets (OpenCV.js, Tesseract worker + WASM core)
// from node_modules into public/vendor so the app works fully offline and
// never depends on a third-party CDN at runtime.
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor');

mkdirSync(join(out, 'tesseract-core'), { recursive: true });
mkdirSync(join(out, 'tesseract'), { recursive: true });

cpSync(join(nm, '@techstark/opencv-js/dist/opencv.js'), join(out, 'opencv.js'));
cpSync(join(nm, 'tesseract.js/dist/worker.min.js'), join(out, 'tesseract/worker.min.js'));

// Only the LSTM-only builds are needed (OEM.LSTM_ONLY); the worker picks the
// best of simd / relaxedsimd / plain at runtime.
const coreDir = join(nm, 'tesseract.js-core');
for (const f of readdirSync(coreDir)) {
  if (/^tesseract-core(-relaxedsimd|-simd)?-lstm\.(wasm|wasm\.js)$/.test(f)) {
    cpSync(join(coreDir, f), join(out, 'tesseract-core', f));
  }
}

if (!existsSync(join(out, 'opencv.js'))) throw new Error('vendor sync failed');
console.log('vendor assets synced to public/vendor');
