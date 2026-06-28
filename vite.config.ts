import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const typstRenderProxyTarget = process.env.VITE_TYPST_RENDER_PROXY_TARGET || 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
            if (id.includes('@radix-ui')) return 'vendor-radix';
            if (id.includes('lucide-react')) return 'vendor-icons';
          }
        },
      },
    },
  },
  server: {
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 25,
      },
    },
    proxy: {
      '/api/render/typst': {
        target: typstRenderProxyTarget,
        changeOrigin: true,
      },
      '/api/intake': {
        target: typstRenderProxyTarget,
        changeOrigin: true,
      },
      '/api/tailor': {
        target: typstRenderProxyTarget,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
