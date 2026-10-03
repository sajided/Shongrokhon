// Copies the QR decoder's WebAssembly into public/ so the app serves it itself
// instead of loading it from a CDN (see src/lib/qr/decoder.ts). Runs on install.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const reader = require.resolve('zxing-wasm/reader', { paths: [dirname(require.resolve('barcode-detector'))] });
const wasm = join(dirname(reader), '..', '..', 'reader', 'zxing_reader.wasm');
mkdirSync('public/zxing', { recursive: true });
copyFileSync(wasm, 'public/zxing/zxing_reader.wasm');
