import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Go 后端默认监听 3000（common/init.go:18）
  const backend = env.VITE_BACKEND_ORIGIN || 'http://localhost:3000'
  // 端口/host 走 env，便于在 .env.local（已 gitignore）里覆盖，避免本地调试改动污染工作区
  const port = Number(env.VITE_DEV_PORT) || 5173
  const host = env.VITE_DEV_HOST === 'true'

  return {
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host,
      port,
      // 后端 /api 组未挂全局 CORS，且 session cookie 为 SameSite=Strict，
      // 跨端口直连必定失败 —— 开发期一律走 proxy。
      // changeOrigin 保持 false：保留原始 Host，避免 cookie domain 校验问题。
      proxy: {
        // ws: true —— /api/support/.../ws 是 WebSocket 升级请求，不加这个开关
        // http-proxy 不会转发 Upgrade 头，握手会退化成 200 而非 101。
        '/api': { target: backend, changeOrigin: false, ws: true },
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
