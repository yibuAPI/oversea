import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { captureAffFromQuery } from '@/utils/aff-code'

/**
 * 控制台路由挂在 ConsoleLayout 下（嵌套路由），
 * 侧栏/顶栏因此只挂载一次，切页不重建 —— 也就没有闪烁。
 *
 * meta.titleKey 供顶栏面包屑取用，值是 i18n key 而非字面量，
 * 这样切语言时面包屑会跟着变。
 */
const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/NewHomePage.vue'),
    },
    {
      /** 文档站：独立 GitBook 式 chrome，不套 PublicLayout 的悬浮导航 */
      path: '/docs',
      name: 'docs',
      component: () => import('@/pages/public/DocsPage.vue'),
    },
    {
      /** 公开区（未登录可访问）：悬浮导航 + 页脚的通用外壳 */
      path: '/',
      component: () => import('@/layouts/PublicLayout.vue'),
      children: [
        {
          path: 'models',
          name: 'models',
          component: () => import('@/pages/public/ModelsPage.vue'),
        },
        {
          path: 'pricing',
          name: 'pricing',
          component: () => import('@/pages/public/PricingPage.vue'),
        },
        {
          path: 'rankings',
          name: 'rankings',
          component: () => import('@/pages/public/RankingsPage.vue'),
        },
        {
          /** 联系我们 —— 渲染后台 /api/about 富文本 */
          path: 'about',
          name: 'about',
          component: () => import('@/pages/public/ContactPage.vue'),
        },
        {
          /** 关于我们 —— 静态展示页（不渲染后台富文本，与 /about 区分） */
          path: 'company',
          name: 'company',
          component: () => import('@/pages/public/AboutPage.vue'),
        },
        {
          /** 旧 /contact 已并入 /about（后台 about 逻辑），重定向防止断链 */
          path: 'contact',
          redirect: '/about',
        },
      ],
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/pages/RegisterPage.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/console',
      component: () => import('@/layouts/ConsoleLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'console',
          component: () => import('@/pages/console/DashboardPage.vue'),
          meta: { titleKey: 'console.nav.dashboard' },
        },
        {
          path: 'keys',
          name: 'console-keys',
          component: () => import('@/pages/console/ApiKeysPage.vue'),
          meta: { titleKey: 'console.nav.apiKeys' },
        },
        {
          path: 'limits',
          name: 'console-limits',
          component: () => import('@/pages/console/QuotaLimitPage.vue'),
          meta: { titleKey: 'console.nav.quotaLimit' },
        },
        {
          path: 'models',
          name: 'console-models',
          component: () => import('@/pages/console/ModelsPage.vue'),
          meta: { titleKey: 'console.nav.models' },
        },
        {
          path: 'playground',
          name: 'console-playground',
          component: () => import('@/pages/console/PlaygroundPage.vue'),
          meta: { titleKey: 'console.nav.playground' },
        },
        {
          path: 'docs',
          name: 'console-docs',
          component: () => import('@/pages/console/DocsPage.vue'),
          meta: { titleKey: 'console.nav.docs' },
        },
        {
          path: 'cost',
          name: 'console-cost',
          component: () => import('@/pages/console/CostPage.vue'),
          meta: { titleKey: 'console.nav.cost' },
        },
        {
          path: 'billing',
          name: 'console-billing',
          component: () => import('@/pages/console/BillingPage.vue'),
          meta: { titleKey: 'console.nav.billing' },
        },
        // 暂隐藏 /console/budgets，后续再开放
        // {
        //   path: 'budgets',
        //   name: 'console-budgets',
        //   component: () => import('@/pages/console/BudgetsPage.vue'),
        //   meta: { titleKey: 'console.nav.budgets' },
        // },
        {
          path: 'discount',
          name: 'console-discount',
          component: () => import('@/pages/console/DiscountPage.vue'),
          meta: { titleKey: 'console.nav.discount' },
        },
        {
          path: 'usage',
          name: 'console-usage',
          component: () => import('@/pages/console/UsagePage.vue'),
          meta: { titleKey: 'console.nav.usage' },
        },
        {
          path: 'logs',
          name: 'console-logs',
          component: () => import('@/pages/console/LogsPage.vue'),
          meta: { titleKey: 'console.nav.logs' },
        },
        {
          path: 'integrations',
          name: 'console-integrations',
          component: () => import('@/pages/console/IntegrationsPage.vue'),
          meta: { titleKey: 'console.nav.integrations' },
        },
        {
          path: 'settings',
          name: 'console-settings',
          component: () => import('@/pages/console/SettingsPage.vue'),
          meta: { titleKey: 'console.nav.settings' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/pages/NotFoundPage.vue'),
    },
  ],
})

/**
 * 登录态本体是后端 session cookie，前端无法同步判断 ——
 * 故守卫里必须 await 一次 /api/user/self 才能确认。
 * ensureResolved() 内部有缓存，只在首次导航时真正发请求。
 */
router.beforeEach(async (to) => {
  // 无论去向哪，先把 URL 上的 ?aff= 收进持久层，避免跳转/登录后被弹走而丢失
  captureAffFromQuery(to.query)

  const user = useUserStore()

  if (to.meta.requiresAuth || to.meta.guestOnly) {
    await user.ensureResolved()
  }

  if (to.meta.requiresAuth && !user.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && user.isLoggedIn) {
    return { name: 'console' }
  }
  return true
})

export default router
