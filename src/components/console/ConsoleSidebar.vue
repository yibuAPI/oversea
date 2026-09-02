<script setup lang="ts">
/**
 * 控制台左侧栏 —— 对齐 infron 的结构：
 *   顶部  品牌 + 余额药丸
 *   中部  分组导航（Cost Management / Analysis / AI Gateway）
 *   底部  用户条，点开是 popover（设置 / 充值 / 帮助 / 登出）
 *
 * 宽度 256px，桌面常驻；lg 以下抽屉式（由父组件控制 open）。
 * 导航项按后端能力过滤：签到未开、订阅无套餐时不显示对应入口 ——
 * 宁可少一项，也不要点进去看到空页面。
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard,
  KeyRound,
  Gauge,
  Boxes,
  MessageSquare,
  FileText,
  PieChart,
  Receipt,
  BadgePercent,
  Activity,
  ScrollText,
  Plug,
  Settings,
  CreditCard,
  LifeBuoy,
  LogOut,
  ChevronsUpDown,
  Plus,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { formatQuota } from '@/lib/format'

const emit = defineEmits<{ navigate: [] }>()

const site = useSiteStore()
const user = useUserStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { systemName, logo, quotaPerUnit } = storeToRefs(site)

const balance = computed(() => formatQuota(user.quota, quotaPerUnit.value))
const displayName = computed(
  () => user.user?.display_name || user.user?.username || '',
)
const initial = computed(() => (displayName.value[0] || '?').toUpperCase())

/** 分组导航。与 infron 的三组分法一致 */
const groups = computed(() => [
  {
    label: t('console.nav.groupChat'),
    items: [
      { to: '/console/playground', icon: MessageSquare, label: t('console.nav.playground') },
    ],
  },
  {
    label: t('console.nav.groupConsole'),
    items: [
      { to: '/console', icon: LayoutDashboard, label: t('console.nav.dashboard') },
      { to: '/console/keys', icon: KeyRound, label: t('console.nav.apiKeys') },
      { to: '/console/limits', icon: Gauge, label: t('console.nav.quotaLimit') },
      { to: '/console/models', icon: Boxes, label: t('console.nav.models') },
      { to: '/console/docs', icon: FileText, label: t('console.nav.docs') },
    ],
  },
  {
    label: t('console.nav.groupCost'),
    items: [
      { to: '/console/cost', icon: PieChart, label: t('console.nav.cost') },
      { to: '/console/billing', icon: Receipt, label: t('console.nav.billing') },
      // { to: '/console/budgets', icon: BellRing, label: t('console.nav.budgets') }, // 暂隐藏，后续再开放
      { to: '/console/discount', icon: BadgePercent, label: t('console.nav.discount') },
    ],
  },
  {
    label: t('console.nav.groupAnalysis'),
    items: [
      { to: '/console/usage', icon: Activity, label: t('console.nav.usage') },
      { to: '/console/logs', icon: ScrollText, label: t('console.nav.logs') },
    ],
  },
  {
    label: t('console.nav.groupGateway'),
    items: [
      { to: '/console/integrations', icon: Plug, label: t('console.nav.integrations') },
    ],
  },
])

/** /console 是精确匹配，其余按前缀 —— 否则子路由会把首页也点亮 */
function isActive(to: string) {
  return to === '/console' ? route.path === to : route.path.startsWith(to)
}

const menuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (menuOpen.value && !menuRef.value?.contains(e.target as Node)) menuOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

async function onSignOut() {
  menuOpen.value = false
  await user.logout()
  await router.replace('/')
}
</script>

<template>
  <div class="flex h-full w-64 flex-col border-r border-border bg-bg-subtle">
    <!-- 品牌 -->
    <div class="flex h-14 shrink-0 items-center gap-2.5 px-4">
      <RouterLink to="/" class="flex items-center gap-2.5 overflow-hidden">
        <img :src="logo" :alt="systemName" class="size-7 shrink-0 rounded-md" />
        <span class="truncate text-[15px] font-semibold tracking-tight">
          {{ systemName }}
        </span>
      </RouterLink>
    </div>

    <!-- 余额药丸：点击直达充值 -->
    <div class="px-3 pb-1">
      <RouterLink
        to="/console/billing"
        class="motion-press group flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 hover:-translate-y-px hover:border-border-strong"
      >
        <span class="min-w-0 flex-1">
          <span class="block text-[11px] leading-tight text-fg-subtle">
            {{ t('console.balance') }}
          </span>
          <span class="block truncate text-[14px] font-semibold leading-tight tabular">
            {{ balance }}
          </span>
        </span>
        <span
          class="flex size-6 shrink-0 items-center justify-center rounded-md bg-bg-inset text-fg-muted transition-colors group-hover:bg-accent group-hover:text-fg-on-accent"
          :aria-label="t('console.topUp')"
        >
          <Plus class="size-3.5" />
        </span>
      </RouterLink>
    </div>

    <!-- 导航 -->
    <nav class="flex-1 overflow-y-auto px-3 py-2" :aria-label="t('nav.console')">
      <div v-for="(g, gi) in groups" :key="gi" :class="gi > 0 ? 'mt-5' : ''">
        <p
          v-if="g.label"
          class="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-subtle"
        >
          {{ g.label }}
        </p>
        <ul class="space-y-0.5">
          <li v-for="item in g.items" :key="item.to">
            <RouterLink
              :to="item.to"
              class="motion-press flex items-center gap-2.5 rounded-lg px-2 py-[7px] text-[13.5px]"
              :class="
                isActive(item.to)
                  ? 'bg-bg-inset font-medium text-fg'
                  : 'text-fg-muted hover:bg-bg-muted hover:text-fg'
              "
              :aria-current="isActive(item.to) ? 'page' : undefined"
              @click="emit('navigate')"
            >
              <component :is="item.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ item.label }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>

    <!-- 用户条 -->
    <div ref="menuRef" class="relative shrink-0 border-t border-border p-3">
      <button
        type="button"
        class="motion-press flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-bg-muted"
        :aria-expanded="menuOpen"
        aria-haspopup="menu"
        @click="menuOpen = !menuOpen"
      >
        <span
          class="flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-inset text-[12px] font-semibold text-fg"
          aria-hidden="true"
        >
          {{ initial }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-medium leading-tight">
            {{ displayName }}
          </span>
          <span class="block truncate text-[11px] leading-tight text-fg-subtle">
            {{ user.user?.email || user.user?.group || '' }}
          </span>
        </span>
        <ChevronsUpDown class="size-3.5 shrink-0 text-fg-subtle" />
      </button>

      <div
        v-if="menuOpen"
        role="menu"
        class="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
      >
        <RouterLink
          to="/console/settings"
          role="menuitem"
          class="motion-press flex items-center gap-2.5 px-3 py-2 text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
          @click="menuOpen = false; emit('navigate')"
        >
          <Settings class="size-4" />
          {{ t('console.nav.settings') }}
        </RouterLink>
        <RouterLink
          to="/console/billing"
          role="menuitem"
          class="motion-press flex items-center gap-2.5 px-3 py-2 text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
          @click="menuOpen = false; emit('navigate')"
        >
          <CreditCard class="size-4" />
          {{ t('console.nav.payments') }}
        </RouterLink>
        <RouterLink
          to="/console/docs"
          role="menuitem"
          class="motion-press flex items-center gap-2.5 px-3 py-2 text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
          @click="menuOpen = false; emit('navigate')"
        >
          <LifeBuoy class="size-4" />
          {{ t('console.nav.help') }}
        </RouterLink>
        <div class="my-1 h-px bg-border" />
        <button
          type="button"
          role="menuitem"
          class="motion-press flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
          @click="onSignOut"
        >
          <LogOut class="size-4" />
          {{ t('auth.signOut') }}
        </button>
      </div>
    </div>
  </div>
</template>
