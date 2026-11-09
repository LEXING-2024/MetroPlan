import { defineConfig } from 'vite';

// Relative base so `dist/` can be served from any folder, including a subpath
// of a game build or a static file host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // MapLibre itself is a single ~1 MB bundle; that is expected for a map app.
    chunkSizeWarningLimit: 1500,
  },
});
