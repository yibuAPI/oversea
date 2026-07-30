/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 基址，默认 '/api'（开发期经 Vite proxy 转发） */
  readonly VITE_API_BASE?: string
  /** 后端源，仅 dev proxy 使用 */
  readonly VITE_BACKEND_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
