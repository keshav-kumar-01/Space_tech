import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait({
      // The export name of top-level promise
      promiseExportName: "__tla",
      // The function to generate import names of top-level promise, for example:
      // promiseImportName: i => `__tla_${i}`
      promiseImportName: i => `__tla_${i}`
    })
  ],
  server: {
    port: 3000,
    open: false,
    host: '0.0.0.0',
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        format: 'es',
      },
    },
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
  },
});
