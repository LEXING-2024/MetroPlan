import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // The prebuilt OSM tile pack and local glyphs live under map/offline/public.
  // Vite serves them in dev and copies them to dist/ for the offline game.
  publicDir: 'map/offline/public',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      // 外部脚本会写 .tmpdir/.tmp 原子临时文件；Windows 上 watcher 碰到
      // EBUSY 会直接退出，这些文件不参与构建，忽略即可。
      ignored: ['**/*.tmpdir/**', '**/*.tmpdir', '**/*.tmp'],
    },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
