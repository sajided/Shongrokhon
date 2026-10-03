/**
 * expo-camera decodes QR codes on the web with zxing-wasm (through
 * barcode-detector), which by default downloads its WebAssembly from the
 * jsDelivr CDN. The CSP only allows this origin (TC-P4-SEC-01), so the file is
 * served from `public/zxing/` instead (copied by `scripts/copy-zxing.mjs`).
 * Call before the first scan; repeat calls reuse the same promise.
 */
let ready: Promise<void> | null = null;

export function prepareQrDecoder(): Promise<void> {
  ready ??= import('barcode-detector')
    .then(({ setZXingModuleOverrides }) =>
      setZXingModuleOverrides({
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : prefix + path),
      }),
    )
    .catch(() => undefined); // not a browser (unit tests): nothing to configure
  return ready;
}
