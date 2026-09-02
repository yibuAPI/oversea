<script setup lang="ts">
/**
 * 消费明细。对齐 infron Cost Breakdown：筛选条 + 趋势图 + 分组汇总 + 总计。
 *
 * 数据源两个，各有取舍：
 *   /api/data/self       有时间轴，用来画趋势
 *   /api/data/flow/self  无时间轴但维度更全（含 token_name / channel_name），用来做汇总表
 * 两者都受 30 天跨度限制。
 *
 * 「按令牌」维度只有 flow 接口有，所以切到那个维度时趋势图会提示不可用 ——
 * 与其编个假的时间序列，不如说清楚。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { Download, PieChart } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { getFlowQuotaData, getQuotaData } from '@/api/usage'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AreaChart, { type Point } from '@/components/ui/AreaChart.vue'
import RangePicker, { type RangePreset } from '@/components/console/RangePicker.vue'
import {
  formatAxisLabel,
  formatCompact,
  formatInt,
  formatQuota,
  formatUsd,
  quotaToUsd,
} from '@/lib/format'

const site = useSiteStore()
const { quotaPerUnit } = storeToRefs(site)
const { t } = useI18n()

const preset = ref<RangePreset>('30d')
const now = Math.floor(Date.now() / 1000)
const start = ref(now - 30 * 86400)
const end = ref(now)

/** 汇总维度 */
type Dim = 'model' | 'group' | 'token' | 'channel'
const dim = ref<Dim>('model')

const dataQ = useQuery({
  queryKey: computed(() => ['quota-data', start.value, end.value]),
  queryFn: () => getQuotaData(start.value, end.value),
})

const flowQ = useQuery({
  queryKey: computed(() => ['flow-data', start.value, end.value]),
  queryFn: () => getFlowQuotaData(start.value, end.value),
})

const hourly = computed(() => end.value - start.value <= 2 * 86400)

/** 趋势：按时间桶聚合 quota */
const trendPoints = computed<Point[]>(() => {
  const step = hourly.value ? 3600 : 86400
  const key = (u: number) => {
    if (hourly.value) return u
    const d = new Date(u * 1000)
    d.setHours(0, 0, 0, 0)
    return Math.floor(d.getTime() / 1000)
  }
  const m = new Map<number, number>()
  for (let ts = key(start.value); ts <= end.value; ts += step) m.set(key(ts), 0)
  for (const r of dataQ.data.value ?? []) {
    const k = key(r.created_at)
    if (m.has(k)) m.set(k, (m.get(k) ?? 0) + r.quota)
  }
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, q]) => ({
      t: ts,
      v: quotaToUsd(q, quotaPerUnit.value),
      label: formatAxisLabel(ts, hourly.value),
    }))
})

interface Row {
  label: string
  quota: number
  tokens: number
  count: number
}

/** 汇总表。flow 接口维度更全，故优先用它 */
const summary = computed<Row[]>(() => {
  const rows = flowQ.data.value ?? []
  const m = new Map<string, Row>()
  for (const r of rows) {
    let label: string
    switch (dim.value) {
      case 'group':
        label = r.use_group || t('cost.unknownGroup')
        break
      case 'token':
        label = r.token_name || t('cost.unknownToken')
        break
      case 'channel':
        label = r.channel_name || (r.channel_id ? `#${r.channel_id}` : t('cost.unknownChannel'))
        break
      default:
        label = r.model_name || t('cost.unknownModel')
    }
    const cur = m.get(label) ?? { label, quota: 0, tokens: 0, count: 0 }
    cur.quota += r.quota
    cur.tokens += r.token_used
    cur.count += r.count
    m.set(label, cur)
  }
  return [...m.values()].sort((a, b) => b.quota - a.quota)
})

const total = computed(() =>
  summary.value.reduce(
    (acc, r) => ({
      quota: acc.quota + r.quota,
      tokens: acc.tokens + r.tokens,
      count: acc.count + r.count,
    }),
    { quota: 0, tokens: 0, count: 0 },
  ),
)

const DIMS: Dim[] = ['model', 'group', 'token', 'channel']

const loading = computed(() => flowQ.isLoading.value)

/** 导出当前汇总为 CSV。纯前端生成，不额外请求后端 */
function exportCsv() {
  const header = [t('cost.colName'), t('cost.colSpend'), t('cost.colRequests'), t('cost.colTokens')]
  const lines = [
    header.join(','),
    ...summary.value.map((r) =>
      [
        // 维度名可能含逗号（中文分组名），必须转义
        `"${r.label.replace(/"/g, '""')}"`,
        quotaToUsd(r.quota, quotaPerUnit.value).toFixed(6),
        r.count,
        r.tokens,
      ].join(','),
    ),
  ]
  const blob = new Blob([`﻿${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cost-${dim.value}-${new Date(start.value * 1000).toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div>
    <PageHeader :title="t('cost.title')" :description="t('cost.subtitle')">
      <template #actions>
        <AppButton size="sm" :disabled="!summary.length" @click="exportCsv">
          <Download class="size-3.5" />
          {{ t('cost.export') }}
        </AppButton>
      </template>
    </PageHeader>

    <!-- 筛选条 -->
    <div class="mb-5 flex flex-wrap items-center gap-3">
      <RangePicker v-model:preset="preset" v-model:start="start" v-model:end="end" />

      <div
        class="inline-flex overflow-hidden rounded-lg border border-border"
        role="group"
        :aria-label="t('cost.groupBy')"
      >
        <button
          v-for="d in DIMS"
          :key="d"
          type="button"
          class="h-8 border-border px-2.5 text-[12.5px] transition-colors not-first:border-l"
          :class="
            dim === d ? 'bg-bg-inset font-medium text-fg' : 'text-fg-muted hover:bg-bg-muted'
          "
          :aria-pressed="dim === d"
          @click="dim = d"
        >
          {{ t(`cost.dim_${d}`) }}
        </button>
      </div>
    </div>

    <!-- 总计 -->
    <div class="mb-5 grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl border border-border bg-bg-elevated p-4">
        <p class="text-[12.5px] text-fg-muted">{{ t('cost.totalSpend') }}</p>
        <p class="mt-1.5 text-[24px] font-semibold leading-tight tabular">
          {{ formatQuota(total.quota, quotaPerUnit) }}
        </p>
      </div>
      <div class="rounded-xl border border-border bg-bg-elevated p-4">
        <p class="text-[12.5px] text-fg-muted">{{ t('cost.colRequests') }}</p>
        <p class="mt-1.5 text-[24px] font-semibold leading-tight tabular">
          {{ formatInt(total.count) }}
        </p>
      </div>
      <div class="rounded-xl border border-border bg-bg-elevated p-4">
        <p class="text-[12.5px] text-fg-muted">{{ t('cost.colTokens') }}</p>
        <p class="mt-1.5 text-[24px] font-semibold leading-tight tabular">
          {{ formatCompact(total.tokens) }}
        </p>
      </div>
    </div>

    <!-- 趋势 -->
    <section class="mb-5 rounded-xl border border-border bg-bg-elevated p-5">
      <h2 class="mb-4 text-[14px] font-semibold">{{ t('cost.trend') }}</h2>
      <AreaChart
        :points="trendPoints"
        :kind="hourly ? 'area' : 'bar'"
        color="#FF8A00"
        :height="240"
        :loading="dataQ.isLoading.value"
        :format="(v) => formatUsd(v)"
      >
        <template #empty>{{ t('cost.noData') }}</template>
      </AreaChart>
    </section>

    <!-- 汇总表 -->
    <section class="overflow-hidden rounded-xl border border-border bg-bg-elevated">
      <div class="border-b border-border px-5 py-3.5">
        <h2 class="text-[14px] font-semibold">
          {{ t('cost.breakdownBy', { dim: t(`cost.dim_${dim}`) }) }}
        </h2>
      </div>

      <div v-if="loading" class="space-y-2 p-5">
        <div v-for="i in 5" :key="i" class="h-8 animate-pulse rounded bg-bg-inset" />
      </div>

      <div v-else-if="!summary.length" class="px-5 py-14 text-center">
        <PieChart class="mx-auto size-7 text-fg-subtle" />
        <p class="mt-3 text-[13px] text-fg-subtle">{{ t('cost.noData') }}</p>
      </div>

      <table v-else class="w-full border-collapse text-[13px]">
        <thead>
          <tr class="border-b border-border bg-bg-subtle">
            <th
              scope="col"
              class="px-5 py-2.5 text-left text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              {{ t('cost.colName') }}
            </th>
            <th
              scope="col"
              class="w-[130px] px-4 py-2.5 text-right text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              {{ t('cost.colSpend') }}
            </th>
            <th
              scope="col"
              class="w-[90px] px-4 py-2.5 text-right text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              {{ t('cost.colShare') }}
            </th>
            <th
              scope="col"
              class="w-[100px] px-4 py-2.5 text-right text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              {{ t('cost.colRequests') }}
            </th>
            <th
              scope="col"
              class="w-[110px] px-5 py-2.5 text-right text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle"
            >
              {{ t('cost.colTokens') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in summary"
            :key="r.label"
            class="border-b border-border last:border-0 hover:bg-bg-subtle"
          >
            <td class="px-5 py-2.5">
              <div class="flex items-center gap-2.5">
                <span class="min-w-0 flex-1 truncate" :title="r.label">{{ r.label }}</span>
              </div>
              <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-inset">
                <div
                  class="h-full rounded-full bg-accent-solid"
                  :style="{
                    width: `${total.quota > 0 ? (r.quota / total.quota) * 100 : 0}%`,
                  }"
                />
              </div>
            </td>
            <td class="px-4 py-2.5 text-right tabular">
              {{ formatQuota(r.quota, quotaPerUnit) }}
            </td>
            <td class="px-4 py-2.5 text-right tabular text-fg-muted">
              {{ total.quota > 0 ? ((r.quota / total.quota) * 100).toFixed(1) : '0.0' }}%
            </td>
            <td class="px-4 py-2.5 text-right tabular text-fg-muted">
              {{ formatInt(r.count) }}
            </td>
            <td class="px-5 py-2.5 text-right tabular text-fg-muted">
              {{ formatCompact(r.tokens) }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-border bg-bg-subtle font-medium">
            <td class="px-5 py-2.5">{{ t('cost.total') }}</td>
            <td class="px-4 py-2.5 text-right tabular">
              {{ formatQuota(total.quota, quotaPerUnit) }}
            </td>
            <td class="px-4 py-2.5 text-right tabular">100%</td>
            <td class="px-4 py-2.5 text-right tabular">{{ formatInt(total.count) }}</td>
            <td class="px-5 py-2.5 text-right tabular">{{ formatCompact(total.tokens) }}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  </div>
</template>
