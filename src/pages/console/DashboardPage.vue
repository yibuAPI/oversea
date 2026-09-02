<script setup lang="ts">
/**
 * 总览页。对齐 infron Dashboard 的三段结构：
 *   1. 三步接入引导（步骤状态由真实数据推导，不是写死的装饰）
 *   2. 三张渐变推广卡
 *   3. 余额/用量概览
 *
 * 「引导」的完成判定：
 *   建密钥 -> 令牌数 > 0
 *   充值   -> quota > 0 或有成功的充值记录
 *   发请求 -> request_count > 0
 * 全部完成后整块收起，不再占地方。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import {
  KeyRound,
  CreditCard,
  Send,
  Check,
  ArrowRight,
  Wallet,
  Activity,
  Coins,
  BookOpen,
  Boxes,
  LifeBuoy,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { listTokens } from '@/api/tokens'
import { getLogStat, getQuotaData } from '@/api/usage'
import StatCard from '@/components/ui/StatCard.vue'
import AreaChart, { type Point } from '@/components/ui/AreaChart.vue'
import { formatQuota, formatCompact, formatInt, formatAxisLabel, quotaToUsd, formatUsd } from '@/lib/format'

const site = useSiteStore()
const user = useUserStore()
const { t } = useI18n()
const { quotaPerUnit, systemName } = storeToRefs(site)

const now = Math.floor(Date.now() / 1000)
const weekAgo = now - 7 * 86400

const tokensQ = useQuery({
  queryKey: ['tokens', 'count'],
  queryFn: () => listTokens({ p: 1, page_size: 1 }),
})

const statQ = useQuery({
  queryKey: ['log-stat', 'week'],
  queryFn: () => getLogStat({ start_timestamp: weekAgo, end_timestamp: now }),
})

const dataQ = useQuery({
  queryKey: ['quota-data', 'week'],
  queryFn: () => getQuotaData(weekAgo, now),
})

const tokenCount = computed(() => tokensQ.data.value?.total ?? 0)
const requestCount = computed(() => user.user?.request_count ?? 0)

const steps = computed(() => [
  {
    icon: KeyRound,
    title: t('dash.step1Title'),
    desc: t('dash.step1Desc'),
    to: '/console/keys',
    done: tokenCount.value > 0,
  },
  {
    icon: CreditCard,
    title: t('dash.step2Title'),
    desc: t('dash.step2Desc'),
    to: '/console/billing',
    done: user.quota > 0 || user.usedQuota > 0,
  },
  {
    icon: Send,
    title: t('dash.step3Title'),
    desc: t('dash.step3Desc'),
    to: '/console/docs',
    done: requestCount.value > 0,
  },
])

const allDone = computed(() => steps.value.every((s) => s.done))
/** 用户手动收起后不再展开，但只在本次会话内生效 */
const dismissed = ref(false)
const showOnboarding = computed(() => !allDone.value && !dismissed.value)

/** 按天聚合本周消费，画柱图 */
const weekPoints = computed<Point[]>(() => {
  const rows = dataQ.data.value ?? []
  const byDay = new Map<number, number>()
  // 先把 7 天的槽位铺满，没有数据的那天也要出现在图上（否则轴会骗人）
  for (let i = 6; i >= 0; i--) {
    const d = new Date((now - i * 86400) * 1000)
    d.setHours(0, 0, 0, 0)
    byDay.set(Math.floor(d.getTime() / 1000), 0)
  }
  for (const r of rows) {
    const d = new Date(r.created_at * 1000)
    d.setHours(0, 0, 0, 0)
    const k = Math.floor(d.getTime() / 1000)
    if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + r.quota)
  }
  return [...byDay.entries()].map(([tsec, quota]) => ({
    t: tsec,
    v: quotaToUsd(quota, quotaPerUnit.value),
    label: formatAxisLabel(tsec, false),
  }))
})

const weekSpend = computed(() =>
  (dataQ.data.value ?? []).reduce((s, r) => s + r.quota, 0),
)
const weekTokens = computed(() =>
  (dataQ.data.value ?? []).reduce((s, r) => s + r.token_used, 0),
)
const weekRequests = computed(() =>
  (dataQ.data.value ?? []).reduce((s, r) => s + r.count, 0),
)

/** 推广卡。infron 那三张是产品营销位；这里换成三个真实可去的地方 ——
 * 编造「限时优惠」之类的内容不如指向实际有用的入口。
 */
const promos = [
  {
    icon: Boxes,
    title: 'dash.promoModelsTitle',
    desc: 'dash.promoModelsDesc',
    to: '/console/models',
    from: 'from-[#c9dcff]',
    to2: 'to-[#e9f2ff]',
  },
  {
    icon: BookOpen,
    title: 'dash.promoDocsTitle',
    desc: 'dash.promoDocsDesc',
    to: '/console/docs',
    from: 'from-[#efe9d8]',
    to2: 'to-[#dff5ec]',
  },
  {
    icon: LifeBuoy,
    title: 'dash.promoUsageTitle',
    desc: 'dash.promoUsageDesc',
    to: '/console/usage',
    from: 'from-[#9fb4d8]',
    to2: 'to-[#d8c2d8]',
  },
] as const
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-[20px] font-semibold tracking-tight">
        {{ t('dash.greeting', { name: user.user?.display_name || user.user?.username }) }}
      </h1>
      <p class="mt-1 text-[13px] text-fg-muted">
        {{ t('dash.subtitle', { name: systemName }) }}
      </p>
    </div>

    <!-- 接入引导 -->
    <section
      v-if="showOnboarding"
      class="mb-6 overflow-hidden rounded-xl border border-border bg-bg-elevated"
      :aria-label="t('dash.getStarted')"
    >
      <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <h2 class="text-[14px] font-semibold">{{ t('dash.getStarted') }}</h2>
          <p class="mt-0.5 text-[12px] text-fg-muted">
            {{ t('dash.getStartedHint') }}
          </p>
        </div>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-1 text-[12px] text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
          @click="dismissed = true"
        >
          {{ t('dash.dismiss') }}
        </button>
      </div>

      <ol class="divide-y divide-border">
        <li v-for="(s, i) in steps" :key="i">
          <RouterLink
            :to="s.to"
            class="motion-press group flex items-center gap-3.5 px-5 py-3.5 hover:bg-bg-subtle"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="
                s.done
                  ? 'border-success-border bg-success-bg text-success-fg'
                  : 'border-border bg-bg-muted text-fg-muted'
              "
            >
              <Check v-if="s.done" class="size-4" />
              <component :is="s.icon" v-else class="size-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span
                class="block text-[13.5px] font-medium"
                :class="s.done ? 'text-fg-muted line-through' : ''"
              >
                {{ i + 1 }}. {{ s.title }}
              </span>
              <span class="mt-0.5 block text-[12px] text-fg-subtle">{{ s.desc }}</span>
            </span>
            <ArrowRight
              class="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5"
            />
          </RouterLink>
        </li>
      </ol>
    </section>

    <!-- 概览指标 -->
    <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        :label="t('dash.balance')"
        :value="formatQuota(user.quota, quotaPerUnit)"
        :icon="Wallet"
        :hint="t('dash.available')"
      />
      <StatCard
        :label="t('dash.weekSpend')"
        :value="formatQuota(weekSpend, quotaPerUnit)"
        :icon="Coins"
        :loading="dataQ.isLoading.value"
        :hint="t('dash.last7d')"
      />
      <StatCard
        :label="t('dash.weekRequests')"
        :value="formatInt(weekRequests)"
        :icon="Activity"
        :loading="dataQ.isLoading.value"
        :hint="t('dash.last7d')"
      />
      <StatCard
        :label="t('dash.weekTokens')"
        :value="formatCompact(weekTokens)"
        :icon="Send"
        :loading="dataQ.isLoading.value"
        :hint="t('dash.last7d')"
      />
    </div>

    <!-- 本周消费趋势 -->
    <section class="mb-6 rounded-xl border border-border bg-bg-elevated p-5">
      <div class="mb-4 flex items-baseline justify-between gap-3">
        <h2 class="text-[14px] font-semibold">{{ t('dash.spendTrend') }}</h2>
        <RouterLink
          to="/console/cost"
          class="text-[12.5px] text-accent transition-colors hover:text-accent-hover"
        >
          {{ t('dash.viewDetail') }}
        </RouterLink>
      </div>
      <AreaChart
        :points="weekPoints"
        kind="bar"
        color="#FF8A00"
        :height="200"
        :loading="dataQ.isLoading.value"
        :format="(v) => formatUsd(v)"
      >
        <template #empty>{{ t('dash.noSpendYet') }}</template>
      </AreaChart>
    </section>

    <!-- 推广卡。渐变抄 infron 三张卡的实测配色：baby-blue / 暖米-薄荷 / 灰蓝-紫粉 -->
    <div class="grid gap-3 sm:grid-cols-3">
      <RouterLink
        v-for="p in promos"
        :key="p.to"
        :to="p.to"
        class="group relative overflow-hidden rounded-xl border border-border bg-gradient-to-br p-4 transition-transform hover:-translate-y-0.5"
        :class="[p.from, p.to2]"
      >
        <!-- 文字写死深藏青：infron 这三张卡在暗色主题下依然是浅色渐变底，
             若用 text-fg 暗色主题下会变白字，浅底白字不可读 -->
        <component :is="p.icon" class="size-5 text-[#16202e]" />
        <p class="mt-3 text-[14px] font-semibold text-[#16202e]">{{ t(p.title) }}</p>
        <p class="mt-1 text-[12px] leading-relaxed text-[#16202e]/70">{{ t(p.desc) }}</p>
        <ArrowRight
          class="mt-3 size-4 text-[#16202e]/60 transition-transform group-hover:translate-x-0.5"
        />
      </RouterLink>
    </div>

    <!-- RPM/TPM 实时值：后端按最近一分钟算，与上面的时间窗无关，故单独放 -->
    <p v-if="statQ.data.value" class="mt-4 text-[12px] text-fg-subtle">
      {{ t('dash.realtime', {
        rpm: formatInt(statQ.data.value.rpm),
        tpm: formatCompact(statQ.data.value.tpm),
      }) }}
    </p>
  </div>
</template>
