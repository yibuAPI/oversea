import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import BeautifulChat from 'vue3-beautiful-chat'

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

// 在线客服窗（访客端 SupportWidget）。这个包的 default 导出是**插件**而不是组件：
//   const ft = { install(app) { app.config.globalProperties.$event = 事件总线
//                               app.component('BeautifulChat', 真组件) } }
// 所以必须 app.use 注册，模板里的 <BeautifulChat> 才解析得到东西。
// 直接 import 完当组件用的话，Vue 拿到的是一个只有 install 的普通对象 ——
// 没有 render/setup/template，最终渲染成一个空注释节点（<!--->），
// 窗口里什么都没有。另外 $event 也只在 install 里挂到 globalProperties，
// 而 UserInput 的 mounted() 要调 this.$event.$on(...)，不装插件会直接抛错。
app.use(BeautifulChat)
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
//
// ⚠️ 只有「本来就要求登录」的页面才踢去登录页。匿名访客打开 /register?aff=xxx
// 这类游客页时，路由守卫会先探测一次 GET /api/user/self —— 后端对匿名请求
// 一律返回 401（middleware/auth.go authHelper），那是预期结果而非掉登录态。
// 在这里无条件 replace 会把地址栏上的邀请码冲掉并把人送进登录页（返利链接失效）。
setUnauthorizedHandler(() => {
  const user = useUserStore(pinia)
  user.clear()
  const current = router.currentRoute.value
  // 首屏导航尚未完成时 currentRoute 是 START_LOCATION（meta 为空），同样不跳转
  if (current.meta.requiresAuth && current.name !== 'login') {
    router.replace({ name: 'login', query: { redirect: current.fullPath } })
  }
})

app.use(router)

// 站点配置需在首屏渲染前就位（站名、logo、导航开关都依赖它）。
// 失败不阻断启动 —— 后端未运行时应看到界面与错误提示，而非白屏。
const site = useSiteStore(pinia)
site.load().finally(() => {
  app.mount('#app')
  // 挂载后开始轮询公告：后端没有推送端点，不轮询用户就得刷新页面才看到新消息
  site.startNoticePolling()
})
