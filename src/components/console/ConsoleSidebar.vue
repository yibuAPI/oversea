<script setup lang="ts">
/**
 * 控制台左侧栏 —— 对齐 infron 的结构：
 *   顶部  品牌 + 余额药丸
 *   中部  分组导航（Cost Management / Analysis / AI Gateway）
 *
 * 账号入口（账号设置 / 充值记录 / 帮助与支持 / 退出登录）在顶栏右上角，
 * 见 components/layout/UserMenu.vue —— 放在这里的话，窄屏收成抽屉后
 * 用户得先拉开抽屉才够得着账号。
 *
 * 宽度 256px，桌面常驻；lg 以下抽屉式（由父组件控制 open）。
 * 导航项按后端能力过滤：签到未开、订阅无套餐时不显示对应入口 ——
 * 宁可少一项，也不要点进去看到空页面。
 */
import { computed, type Component } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import {
  LayoutDashboard,
  KeyRound,
  Gauge,
  MessageSquare,
  FileText,
  PieChart,
  Receipt,
  BadgePercent,
  Activity,
  ScrollText,
  Plug,
  Ticket,
  Plus,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { useTicketUnread } from '@/composables/useTicketUnread'
import { formatQuota } from '@/lib/format'

const emit = defineEmits<{ navigate: [] }>()

const site = useSiteStore()
const user = useUserStore()
const route = useRoute()
const { t } = useI18n()
const { systemName, logo, quotaPerUnit, ticketSystemEnabled } = storeToRefs(site)

// 工单未读数。侧栏是控制台唯一常驻的组件，红点挂在这里才能让用户在任何页面
// 都看到客服的新回复 —— 工单的 WebSocket 只按工单 id 分房间，不在详情页收不到。
const { unread: ticketUnread } = useTicketUnread()

const balance = computed(() => formatQuota(user.quota, quotaPerUnit.value))

interface NavItem {
  to: string
  icon: Component
  label: string
  /** 未读徽标数。0 或 undefined 不渲染 */
  badge?: number
}

/** 分组导航。与 infron 的三组分法一致 */
const groups = computed<{ label: string; items: NavItem[] }[]>(() => [
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
      // 暂隐藏模型库入口，后续再开放
      // { to: '/console/models', icon: Boxes, label: t('console.nav.models') },
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
  // 工单系统关掉时整组都不出现：后端 /api/tickets/** 会直接拒绝请求，
  // 留着入口只会让人点进一个报错页（路由守卫也会把人弹回控制台首页）。
  // 必须整组展开／不展开，只把 items 置空会留下一个没有条目的组标题。
  ...(ticketSystemEnabled.value
    ? [
        {
          label: t('console.nav.groupSupport'),
          items: [
            {
              to: '/console/tickets',
              icon: Ticket,
              label: t('console.nav.tickets'),
              badge: ticketUnread.value,
            },
          ],
        },
      ]
    : []),
])

/** /console 是精确匹配，其余按前缀 —— 否则子路由会把首页也点亮 */
function isActive(to: string) {
  return to === '/console' ? route.path === to : route.path.startsWith(to)
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
              <!-- 未读徽标（目前只有工单用）。样式对齐工单列表页行内的红点 -->
              <span
                v-if="item.badge"
                class="ml-auto shrink-0 rounded-full bg-danger-bg px-1.5 text-[10.5px] font-medium tabular-nums text-danger-fg"
                :title="t('tickets.unreadTip', { n: item.badge })"
              >
                {{ item.badge }}
              </span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
  </div>
</template>
