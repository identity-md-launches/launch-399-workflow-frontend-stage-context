import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The export is served from IPFS gateways, ENS names and gateway subpaths, so every
// asset URL must be relative (`./assets/...`). No routes, no server rewrites.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
