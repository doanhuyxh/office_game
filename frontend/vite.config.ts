import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { legacyColorFallback } from './scripts/legacy-color-fallback.ts';

const shared = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [
      react(),
      tailwindcss(),
      legacyColorFallback(fileURLToPath(new URL('./src/assets/styles/global.css', import.meta.url))),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': shared,
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      fs: { allow: ['.', shared] },
      // Dev: cùng origin với API → cookie đăng nhập hoạt động giống production.
      proxy: {
        '/api': { target: env.VITE_API_TARGET ?? 'http://localhost:5080' },
        '/health': { target: env.VITE_API_TARGET ?? 'http://localhost:5080' }, // trang bảo trì tự kiểm tra API còn sống
        '/rt': { target: env.VITE_RT_TARGET ?? 'http://localhost:5090', ws: true },
        // Máy chủ MCP cho trợ lý AI — chỉ `/mcp` và `/mcp/…` (regex), KHÔNG nuốt trang SPA `/mcp-tools` (mở thẳng / tải lại → 502). Giống nginx `location = /mcp`.
        '^/mcp(/|$|\\?)': { target: env.VITE_MCP_TARGET ?? 'http://localhost:5100' },
        '/.well-known/oauth-': { target: env.VITE_MCP_TARGET ?? 'http://localhost:5100' }, // OAuth discovery
      },
    },
    build: {
      // Mặc định Vite 8 = Safari 16.4+ → iPhone đời cũ (iOS 15, vd. 6s/7) lỗi cú pháp `static {}` → màn hình trống.
      // Hạ target để Oxc/Lightning CSS chuyển cú pháp JS + màu CSS (color-mix, oklch) về dạng Safari 15 hiểu.
      target: ['es2020', 'safari15', 'chrome100', 'firefox100', 'edge100'],
      chunkSizeWarningLimit: 700, // three.js ~645 KB, livekit ~570 KB — đều tách chunk riêng, lazy
      rollupOptions: {
        output: { manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined) },
      },
    },
  };
});
