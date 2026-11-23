import { defineConfig } from 'vite';

const CF_PAGES_MAX_FILE_BYTES = 24 * 1024 * 1024;

function excludeOversizedWasmAssets() {
  return {
    name: 'exclude-oversized-wasm-assets',
    generateBundle(_options, bundle) {
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith('.wasm') && asset.type === 'asset') {
          const byteLength =
            typeof asset.source === 'string'
              ? Buffer.byteLength(asset.source)
              : asset.source.byteLength;
          if (byteLength > CF_PAGES_MAX_FILE_BYTES) {
            delete bundle[fileName];
          }
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  plugins: [excludeOversizedWasmAssets()],
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
});
