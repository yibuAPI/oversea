import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Go 后端默认监听 3000（common/init.go:18）
  const backend = env.VITE_BACKEND_ORIGIN || 'http://localhost:3000'

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      // 后端 /api 组未挂全局 CORS，且 session cookie 为 SameSite=Strict，
      // 跨端口直连必定失败 —— 开发期一律走 proxy。
      // changeOrigin 保持 false：保留原始 Host，避免 cookie domain 校验问题。
      proxy: {
        '/api': { target: backend, changeOrigin: false },
        '/v1': { target: backend, changeOrigin: false },
        '/pg': { target: backend, changeOrigin: false },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
  }
})
