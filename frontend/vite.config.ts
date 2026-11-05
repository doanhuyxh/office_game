import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const shared = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [
      react(),
      tailwindcss(),
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
        '/rt': { target: env.VITE_RT_TARGET ?? 'http://localhost:5090', ws: true },
      },
    },
    build: {
      chunkSizeWarningLimit: 600, // three.js ~540KB, đã tách chunk riêng
      rollupOptions: {
        output: { manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined) },
      },
    },
  };
});
