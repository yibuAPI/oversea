<script setup lang="ts">
/**
 * 用量与活动。对齐 infron Usage & Activity 页：
 *   顶部六个指标卡 → Tokens 图 + 缓存命中率图 → 模型明细（列表/网格切换）
 *
 * 数据全部来自 /api/data/self（唯一带时间轴的接口，按小时分桶）。
 * 缓存命中率 = cache_tokens / token_used —— 后端给的是原始计数，比率前端算。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import {
  Activity,
  Coins,
  Database,
  LayoutGrid,
  List,
  Send,
  Timer,
  Boxes,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { getQuotaData, getLogStat } from '@/api/usage'
import StatCard from '@/components/ui/StatCard.vue'
import AreaChart, { type Point } from '@/components/ui/AreaChart.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import RangePicker, { type RangePreset } from '@/components/console/RangePicker.vue'
import {
  formatCompact,
  formatInt,
  formatPercent,
  formatQuota,
  formatUsd,
  formatAxisLabel,
  quotaToUsd,
} from '@/lib/format'

const site = useSiteStore()
const { quotaPerUnit } = storeToRefs(site)
const { t } = useI18n()

const preset = ref<RangePreset>('7d')
const now = Math.floor(Date.now() / 1000)
const start = ref(now - 7 * 86400)
const end = ref(now)

const dataQ = useQuery({
  queryKey: computed(() => ['quota-data', start.value, end.value]),
  queryFn: () => getQuotaData(start.value, end.value),
})

const statQ = useQuery({
  queryKey: computed(() => ['log-stat', start.value, end.value]),
  queryFn: () => getLogStat({ start_timestamp: start.value, end_timestamp: end.value }),
})

const rows = computed(() => dataQ.data.value ?? [])

/** 跨度 ≤ 2 天时按小时展示，否则按天 —— 30 天 × 24 点会挤成一团 */
const hourly = computed(() => end.value - start.value <= 2 * 86400)

const totals = computed(() => {
  let quota = 0
  let tokens = 0
  let count = 0
  let cache = 0
  let cacheCreate = 0
  for (const r of rows.value) {
    quota += r.quota
    tokens += r.token_used
    count += r.count
    cache += r.cache_tokens
    cacheCreate += r.cache_creation_tokens
  }
  return { quota, tokens, count, cache, cacheCreate }
})

/** 平均单次成本。请求数为 0 时不能除，直接给 0 */
const avgCost = computed(() =>
  totals.value.count > 0 ? totals.value.quota / totals.value.count : 0,
)

const cacheRate = computed(() =>
  totals.value.tokens > 0 ? totals.value.cache / totals.value.tokens : 0,
)

/** 按时间桶聚合。桶键：小时模式用原始 created_at，天模式取当地零点 */
function bucketKey(unix: number) {
  if (hourly.value) return unix
  const d = new Date(unix * 1000)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

interface Bucket {
  tokens: number
  quota: number
  count: number
  cache: number
}

const buckets = computed(() => {
  const m = new Map<number, Bucket>()
  // 先铺满时间槽，缺数据的桶要显示为 0 而不是被跳过
  const step = hourly.value ? 3600 : 86400
  const from = bucketKey(start.value)
  for (let ts = from; ts <= end.value; ts += step) {
    m.set(bucketKey(ts), { tokens: 0, quota: 0, count: 0, cache: 0 })
  }
  for (const r of rows.value) {
    const k = bucketKey(r.created_at)
    const b = m.get(k)
    if (!b) continue
    b.tokens += r.token_used
    b.quota += r.quota
    b.count += r.count
    b.cache += r.cache_tokens
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0])
})

const tokenPoints = computed<Point[]>(() =>
  buckets.value.map(([ts, b]) => ({
    t: ts,
    v: b.tokens,
    label: formatAxisLabel(ts, hourly.value),
  })),
)

const cachePoints = computed<Point[]>(() =>
  buckets.value.map(([ts, b]) => ({
    t: ts,
    v: b.tokens > 0 ? (b.cache / b.tokens) * 100 : 0,
    label: formatAxisLabel(ts, hourly.value),
  })),
)

const spendPoints = computed<Point[]>(() =>
  buckets.value.map(([ts, b]) => ({
    t: ts,
    v: quotaToUsd(b.quota, quotaPerUnit.value),
    label: formatAxisLabel(ts, hourly.value),
  })),
)

/** 按模型汇总，消费降序 */
const byModel = computed(() => {
  const m = new Map<string, Bucket>()
  for (const r of rows.value) {
    const cur = m.get(r.model_name) ?? { tokens: 0, quota: 0, count: 0, cache: 0 }
    cur.tokens += r.token_used
    cur.quota += r.quota
    cur.count += r.count
    cur.cache += r.cache_tokens
    m.set(r.model_name, cur)
  }
  return [...m.entries()]
    .map(([name, b]) => ({ name, ...b }))
    .sort((a, b) => b.quota - a.quota)
})

const view = ref<'list' | 'grid'>('list')
const loading = computed(() => dataQ.isLoading.value)
</script>

<template>
  <div>
    <PageHeader :title="t('usage.title')" :description="t('usage.subtitle')">
      <template #actions>
        <RangePicker
          v-model:preset="preset"
          v-model:start="start"
          v-model:end="end"
        />
      </template>
    </PageHeader>

    <!-- 六个指标卡 -->
    <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        :label="t('usage.spend')"
        :value="formatQuota(totals.quota, quotaPerUnit)"
        :icon="Coins"
        :loading="loading"
      />
      <StatCard
        :label="t('usage.requests')"
        :value="formatInt(totals.count)"
        :icon="Activity"
        :loading="loading"
      />
      <StatCard
        :label="t('usage.tokens')"
        :value="formatCompact(totals.tokens)"
        :icon="Send"
        :loading="loading"
      />
      <StatCard
        :label="t('usage.cacheRate')"
        :value="formatPercent(cacheRate)"
        :icon="Database"
        :loading="loading"
        :hint="t('usage.cacheHint', { v: formatCompact(totals.cache) })"
      />
      <StatCard
        :label="t('usage.avgCost')"
        :value="formatQuota(avgCost, quotaPerUnit)"
        :icon="Timer"
        :loading="loading"
        :hint="t('usage.perRequest')"
      />
      <StatCard
        :label="t('usage.models')"
        :value="formatInt(byModel.length)"
        :icon="Boxes"
        :loading="loading"
        :hint="t('usage.modelsHint')"
      />
    </div>

    <!-- Tokens + 缓存命中率 -->
    <div class="mb-6 grid gap-3 lg:grid-cols-2">
      <section class="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 class="mb-4 text-[14px] font-semibold">{{ t('usage.tokensChart') }}</h2>
        <AreaChart
          :points="tokenPoints"
          :loading="loading"
          :format="(v) => formatCompact(v)"
        >
          <template #empty>{{ t('usage.noData') }}</template>
        </AreaChart>
      </section>

      <section class="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 class="mb-4 text-[14px] font-semibold">{{ t('usage.cacheChart') }}</h2>
        <AreaChart
          :points="cachePoints"
          :loading="loading"
          :format="(v) => `${v.toFixed(1)}%`"
        >
          <template #empty>{{ t('usage.noData') }}</template>
        </AreaChart>
      </section>
    </div>

    <!-- 消费趋势 -->
    <section class="mb-6 rounded-xl border border-border bg-bg-elevated p-5">
      <h2 class="mb-4 text-[14px] font-semibold">{{ t('usage.spendChart') }}</h2>
      <AreaChart
        :points="spendPoints"
        :kind="hourly ? 'area' : 'bar'"
        :loading="loading"
        :format="(v) => formatUsd(v)"
      >
        <template #empty>{{ t('usage.noData') }}</template>
      </AreaChart>
    </section>

    <!-- 模型明细 -->
    <section class="rounded-xl border border-border bg-bg-elevated">
      <div class="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 class="text-[14px] font-semibold">{{ t('usage.byModel') }}</h2>
        <div
          class="inline-flex overflow-hidden rounded-lg border border-border"
          role="group"
          :aria-label="t('usage.viewMode')"
        >
          <button
            type="button"
            class="flex size-7 items-center justify-center transition-colors"
            :class="view === 'list' ? 'bg-bg-inset text-fg' : 'text-fg-muted hover:bg-bg-muted'"
            :aria-pressed="view === 'list'"
            :aria-label="t('usage.viewList')"
            @click="view = 'list'"
          >
            <List class="size-3.5" />
          </button>
          <button
            type="button"
            class="flex size-7 items-center justify-center border-l border-border transition-colors"
            :class="view === 'grid' ? 'bg-bg-inset text-fg' : 'text-fg-muted hover:bg-bg-muted'"
            :aria-pressed="view === 'grid'"
            :aria-label="t('usage.viewGrid')"
            @click="view = 'grid'"
          >
            <LayoutGrid class="size-3.5" />
          </button>
        </div>
      </div>

      <div v-if="loading" class="space-y-2 p-5">
        <div v-for="i in 4" :key="i" class="h-9 animate-pulse rounded bg-bg-inset" />
      </div>

      <p v-else-if="!byModel.length" class="px-5 py-12 text-center text-[13px] text-fg-subtle">
        {{ t('usage.noData') }}
      </p>

      <!-- 列表：带占比条，一眼看出谁吃掉了预算 -->
      <ul v-else-if="view === 'list'" class="divide-y divide-border">
        <li
          v-for="m in byModel"
          :key="m.name"
          class="flex items-center gap-4 px-5 py-3"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] font-medium">{{ m.name }}</p>
            <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-inset">
              <div
                class="h-full rounded-full bg-accent-solid"
                :style="{
                  width: `${totals.quota > 0 ? (m.quota / totals.quota) * 100 : 0}%`,
                }"
              />
            </div>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-[13px] font-semibold tabular">
              {{ formatQuota(m.quota, quotaPerUnit) }}
            </p>
            <p class="mt-0.5 text-[11px] text-fg-subtle tabular">
              {{ formatInt(m.count) }} {{ t('usage.reqUnit') }} ·
              {{ formatCompact(m.tokens) }} tok
            </p>
          </div>
        </li>
      </ul>

      <!-- 网格 -->
      <div v-else class="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="m in byModel"
          :key="m.name"
          class="rounded-lg border border-border p-3"
        >
          <p class="truncate text-[12.5px] font-medium" :title="m.name">{{ m.name }}</p>
          <p class="mt-2 text-[17px] font-semibold tabular">
            {{ formatQuota(m.quota, quotaPerUnit) }}
          </p>
          <dl class="mt-2 space-y-0.5 text-[11px] text-fg-subtle">
            <div class="flex justify-between gap-2">
              <dt>{{ t('usage.requests') }}</dt>
              <dd class="tabular">{{ formatInt(m.count) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt>{{ t('usage.tokens') }}</dt>
              <dd class="tabular">{{ formatCompact(m.tokens) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt>{{ t('usage.cacheRate') }}</dt>
              <dd class="tabular">
                {{ m.tokens > 0 ? formatPercent(m.cache / m.tokens) : '0%' }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <p v-if="statQ.data.value" class="mt-4 text-[12px] text-fg-subtle">
      {{ t('usage.realtime', {
        rpm: formatInt(statQ.data.value.rpm),
        tpm: formatCompact(statQ.data.value.tpm),
      }) }}
    </p>
  </div>
</template>
