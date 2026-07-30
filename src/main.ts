import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { setUnauthorizedHandler } from './api/client'
import { useUserStore } from './stores/user'
import { useSiteStore } from './stores/site'
// Inter 可变字体自托管：infron 全站用 Inter，只在 tokens 里写字体名而不加载，
// 实际会静默回落到 Segoe UI，字形完全不同
import '@fontsource-variable/inter'
import './styles/index.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(i18n)
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  },
})

// 401 处理：清本地登录态并跳登录页，保留原路径以便回跳。
// 在 api 层之外注入，避免 api → store → api 的循环依赖。
setUnauthorizedHandler(() => {
  const user = useUserStore(pinia)
  user.clear()
  const current = router.currentRoute.value
  if (current.name !== 'login') {
    router.replace({ name: 'login', query: { redirect: current.fullPath } })
  }
})

app.use(router)

// 站点配置需在首屏渲染前就位（站名、logo、导航开关都依赖它）。
// 失败不阻断启动 —— 后端未运行时应看到界面与错误提示，而非白屏。
const site = useSiteStore(pinia)
site.load().finally(() => {
  app.mount('#app')
})
