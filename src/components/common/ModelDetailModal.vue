<script setup lang="ts">
/**
 * 模型详情弹窗 —— 公开 /models 页，点击模型卡/行后弹出。
 *
 * 四个区块：
 *   基本信息  模型名 / 厂商 / 描述 / 标签
 *   健康状态  最近24小时 / 最近7天 切换，按用户分组逐桶着色（错误率），悬停看明细
 *   API 端点  supported_endpoint_types → supported_endpoint 解析出 协议 + 路径 + 请求方式
 *   分组价格  按用户分组展示倍率 / 计费类型 / 输入 / 输出 / 缓存价，含分组继承链
 *
 * 健康数据（/api/perf-metrics）由本组件按需拉取 —— 弹窗打开才发起请求，
 * 切换时间窗口复用同一 queryKey 换参。success_rate 是 0~100 的百分数。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  CircleCheck,
  Coins,
  Copy,
  Check,
  Info,
  Wrench,
  X,
} from 'lucide-vue-next'
import { getPerfMetrics, inputPrice, outputPrice } from '@/api/models'
import type {
  PerfGroupResult,
  PricingModel,
} from '@/api/types'
import BrandIcon from '@/components/common/BrandIcon.vue'

const props = defineProps<{
  model: PricingModel
  vendorName: string
  icon: string | null
  /** 分组 → 倍率（来自 /api/pricing） */
  groupRatio: Record<string, number>
  /** 分组 → 描述（来自 /api/pricing 的 usable_group） */
  usableGroup?: Record<string, { desc: string; ratio: number }>
  /** 自动分组链（分组继承关系，来自 /api/pricing 的 auto_groups） */
  autoGroups?: string[]
  /** 端点类型 → { path, method }（来自 /api/pricing 的 supported_endpoint） */
  endpointMap?: Record<string, { path?: string; method?: string }>
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

// ───────────────────────── 基本信息 ─────────────────────────

const tagsOf = computed(() =>
  (props.model.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
)

const descOf = computed(() => props.model.description ?? '')

const copyState = ref<'idle' | 'copied'>('idle')
async function copyName() {
  try {
    await navigator.clipboard.writeText(props.model.model_name)
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 1500)
  } catch {
    /* 剪贴板不可用时静默 */
  }
}

// ───────────────────────── 健康状态 ─────────────────────────

const hours = ref(24)
const healthQ = useQuery({
  queryKey: ['perf-metrics', props.model.model_name, hours],
  queryFn: () => getPerfMetrics(props.model.model_name, hours.value),
  enabled: () => !!props.model.model_name,
})

/** 错误率 = 100 − 成功率（成功率是 0~100 百分数，来自后端） */
const errorRateOf = (successRate: number) => Math.max(0, 100 - successRate)

// ── 健康着色档位：按错误率分 6 档，色值尽量贴近参考图 ──
// bins: 0=无数据(灰) 1=正常(0%) 2=<2% 3=2~10% 4=10~25% 5=25~50% 6=>50%
const HEALTH_BINS = [
  {
    key: 'noData',
    bg: 'bg-[#F5F5F5] dark:bg-neutral-800',
    text: 'text-[#9CA3AF] dark:text-neutral-500',
  },
  {
    key: 'normal',
    bg: 'bg-[#10B981] dark:bg-[#059669]',
    text: 'text-white',
  },
  {
    key: 'lt2',
    bg: 'bg-[#34D399] dark:bg-[#10B981]',
    text: 'text-white',
  },
  {
    key: '2to10',
    bg: 'bg-[#F59E0B] dark:bg-[#D97706]',
    text: 'text-white',
  },
  {
    key: '10to25',
    bg: 'bg-[#F97316] dark:bg-[#EA580C]',
    text: 'text-white',
  },
  {
    key: '25to50',
    bg: 'bg-[#EA580C] dark:bg-[#C2410C]',
    text: 'text-white',
  },
  {
    key: 'gt50',
    bg: 'bg-[#EF4444] dark:bg-[#DC2626]',
    text: 'text-white',
  },
]

/** 返回某成功率所处的档位下标（0=无数据，1~6=6 档错误率） */
function binOf(successRate: number, hasData: boolean) {
  if (!hasData) return 0
  const rate = errorRateOf(successRate)
  if (rate <= 0) return 1
  if (rate < 2) return 2
  if (rate <= 10) return 3
  if (rate <= 25) return 4
  if (rate <= 50) return 5
  return 6
}

function toneOf(successRate: number, hasData: boolean) {
  return HEALTH_BINS[binOf(successRate, hasData)]
}

/**
 * 分组结果 → 逐桶(时间格)着色行。
 * 24h 逐小时（24 格）、7 天按天聚合（7 格）：7 天窗口把同一天的桶并入一格。
 * 每格在聚合后附上 tooltip 字段（时间范围/成功/失败/错误率/状态），模板直接取用。
 */
type Bucket = {
  ts: number
  requestCount: number
  successCount: number
  successRate: number
  /** 该格代表的时间起点 */
  bucketStart: number
  /** 该格代表的时间终点（exclusive） */
  bucketEnd: number
  range: string
  fail: number
  errorRate: string
  status: string
  /** 该桶所处的错误率档位下标（0=无数据，1~6） */
  binKey: number
}

const healthRows = computed<
  { group: string; buckets: Bucket[]; successRate: number; requests: number }[]
>(() => {
  const data = healthQ.data.value
  if (!data) return []
  return data.groups.map((g) => {
    const buckets = bucketize(g, hours.value)
    const requests = buckets.reduce((s, b) => s + b.requestCount, 0)
    const success = buckets.reduce((s, b) => s + b.successCount, 0)
    const successRate = requests > 0 ? (success / requests) * 100 : 0
    return { group: g.group, buckets, successRate, requests }
  })
})

function bucketize(group: PerfGroupResult, h: number): Bucket[] {
  const perDay = h > 24
  const span = perDay ? 86400 : 3600
  const byStart = new Map<number, Bucket>()
  for (const p of group.series) {
    const start = p.ts - (p.ts % span)
    const cur = byStart.get(start) ?? {
      ts: start,
      requestCount: 0,
      successCount: 0,
      successRate: 0,
      bucketStart: start,
      bucketEnd: start + span,
      range: '',
      fail: 0,
      errorRate: '',
      status: '',
      binKey: 0,
    }
    cur.requestCount += p.request_count
    cur.successCount += p.success_count
    byStart.set(start, cur)
  }
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  // 汇总每桶的成功率与 tooltip 字段
  for (const b of byStart.values()) {
    b.successRate =
      b.requestCount > 0 ? (b.successCount / b.requestCount) * 100 : 0
    const errorRate = errorRateOf(b.successRate)
    b.range = perDay
      ? dateOnly(b.bucketStart)
      : `${fmt.format(b.bucketStart * 1000)} – ${fmt.format(b.bucketEnd * 1000)}`
    b.fail = b.requestCount - b.successCount
    b.errorRate = `${errorRate.toFixed(1)}%`
    b.binKey = binOf(b.successRate, b.requestCount > 0)
    b.status = t(`public.models.detail.bin${b.binKey}`)
  }
  return [...byStart.values()].sort((a, b) => a.ts - b.ts)
}

function dateOnly(ts: number) {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

// ───────────────────────── API 端点 ─────────────────────────

const endpoints = computed(() => {
  const types = props.model.supported_endpoint_types ?? []
  const map = props.endpointMap ?? {}
  return types
    .map((type) => {
      const info = map[type] ?? {}
      let path = info.path ?? ''
      if (path.includes('{model}')) path = path.replaceAll('{model}', props.model.model_name)
      return { type, path, method: info.method ?? 'POST' }
    })
    .filter((e) => Boolean(e.path))
})

// ───────────────────────── 分组价格 ─────────────────────────

type BillKind = 'token' | 'call' | 'tiered'
const billingKind = computed<BillKind>(() =>
  props.model.billing_mode === 'tiered_expr'
    ? 'tiered'
    : props.model.quota_type === 1
      ? 'call'
      : props.model.quota_type === 2
        ? 'tiered'
        : 'token',
)

const billingLabel = computed(() =>
  billingKind.value === 'call'
    ? t('home.latest.kindCall')
    : billingKind.value === 'tiered'
      ? t('home.latest.kindTiered')
      : t('home.latest.kindToken'),
)

const fmtUsd = (v: number) => `$${v < 1 ? +v.toFixed(3) : +v.toFixed(2)}`

/** 分组描述（后台 usable_group 的 desc，可能没有） */
const groupDesc = (group: string) => props.usableGroup?.[group]?.desc ?? ''

const priceRows = computed(() => {
  const groups = props.model.enable_groups ?? []
  return groups.map((group) => {
    const ratio = props.groupRatio[group] ?? 1
    if (billingKind.value === 'call') {
      return {
        group,
        ratio,
        label: billingLabel.value,
        desc: groupDesc(group),
        input: fmtUsd(props.model.model_price),
        output: null,
        cache: null,
      }
    }
    const input = inputPrice(props.model.model_ratio, ratio)
    const output = outputPrice(props.model.model_ratio, props.model.completion_ratio, ratio)
    const cache =
      typeof props.model.cache_ratio === 'number'
        ? input * props.model.cache_ratio
        : null
    return {
      group,
      ratio,
      label: billingLabel.value,
      desc: groupDesc(group),
      input: fmtUsd(input),
      output: fmtUsd(output),
      cache: cache === null ? null : fmtUsd(cache),
    }
  })
})

/** 分组继承链：auto_groups 里且该模型启用的分组，按顺序串成 → 链 */
const inheritChain = computed(() => {
  const enabled = new Set(props.model.enable_groups ?? [])
  const chain = (props.autoGroups ?? []).filter((g) => enabled.has(g))
  return chain
})

const showHealth = computed(() => healthRows.value.length > 0)

/** 健康图例：6 档错误率（含“正常运行”），仅展示有数据的档位 */
const legendItems = computed(() =>
  HEALTH_BINS.slice(1).map((bin, binKey) => ({
    binKey: binKey + 1,
    label: t(`public.models.detail.bin${binKey + 1}`),
    bg: bin.bg,
  })),
)

// ───────────────────────── 键盘关闭 / 滚动锁定 ─────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})

// 弹窗关闭后清理 query 缓存，避免下次打开闪旧数据
const queryClient = useQueryClient()
watch(
  () => props.model.model_name,
  () => queryClient.removeQueries({ queryKey: ['perf-metrics', props.model.model_name] }),
)
onBeforeUnmount(() => {
  queryClient.removeQueries({ queryKey: ['perf-metrics', props.model.model_name] })
})
</script>

<template>
  <Teleport to="body">
    <!-- 遮罩 -->
    <div
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      :aria-label="model.model_name"
      @click.self="emit('close')"
    >
      <!-- 右侧抽屉 -->
      <div
        class="anim-drawer-in absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-hidden border-l border-[#E5E5E5] bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950 lg:max-w-2xl"
      >
        <!-- 顶部：厂商图标 + 模型名 + 复制 + 关闭 -->
        <header
          class="sticky top-0 z-10 flex items-center gap-3 border-b border-[#EDEDED] bg-white px-5 py-4 dark:border-neutral-800 dark:bg-neutral-950"
        >
          <span
            class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#EDEDED] bg-white p-1 dark:border-neutral-700"
          >
            <BrandIcon :icon="icon" :name="vendorName" variant="light" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <h2
                class="min-w-0 truncate text-lg font-semibold leading-6 text-[#0A0A0A] dark:text-neutral-50"
                :title="model.model_name"
              >
                {{ model.model_name }}
              </h2>
              <button
                type="button"
                :aria-label="t('models.copyName')"
                class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[#8A8A8A] transition-colors hover:bg-[#F5F5F5] hover:text-[#0A0A0A] dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                @click.stop="copyName"
              >
                <Check v-if="copyState === 'copied'" class="size-4 text-success-fg" />
                <Copy v-else class="size-4" />
              </button>
            </div>
            <div class="flex items-center gap-1.5 text-sm text-[#737373] dark:text-neutral-400">
              <span class="truncate">{{ vendorName }}</span>
            </div>
          </div>
          <button
            type="button"
            :aria-label="t('common.close')"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-[#737373] transition-colors hover:bg-[#F5F5F5] hover:text-[#0A0A0A] dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            @click.stop="emit('close')"
          >
            <X class="size-5" />
          </button>
        </header>

        <!-- 内容区：可滚动 -->
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <!-- 基本信息 -->
          <section
            class="rounded-xl border border-[#EDEDED] bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div class="mb-3 flex items-center gap-2.5">
              <span
                class="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-[#DBEAFE] bg-[#EFF6FF] dark:border-blue-500/30 dark:bg-blue-500/10"
              >
                <Info class="size-3.5 text-[#3B82F6] dark:text-blue-400" />
              </span>
              <div class="min-w-0">
                <h3 class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-100">
                  {{ t('public.models.detail.basic') }}
                </h3>
                <p class="text-xs text-[#A3A3A3] dark:text-neutral-500">
                  {{ t('public.models.detail.basicDesc') }}
                </p>
              </div>
            </div>
            <div :class="descOf ? 'mt-3 space-y-3' : ''">
              <p
                class="text-sm leading-5 text-[#525252] dark:text-neutral-400"
              >
                {{ descOf || t('public.models.detail.noDesc') }}
              </p>
              <div class="flex flex-wrap gap-1.5">
                <span
                  class="inline-flex h-[22px] items-center justify-center gap-1 rounded-full border border-[#EDE9FE] bg-[#F5F3FF] px-2 text-xs font-medium leading-4 text-[#7C3AED] dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                >
                  <span class="text-[#A855F7]">{{ vendorName }}</span>
                  <span class="text-[#9CA3AF]">/</span>
                  <span class="text-[#7C3AED]">{{ model.model_name }}</span>
                </span>
                <span
                  v-for="tag in tagsOf"
                  :key="tag"
                  class="inline-flex h-[22px] items-center justify-center rounded-full border border-[#EDE9FE] bg-[#F5F3FF] px-2 text-xs font-medium leading-4 text-[#7C3AED] dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                >
                  {{ tag }}
                </span>
              </div>
            </div>
          </section>

          <!-- 模型健康状态 -->
          <section
            class="mt-4 rounded-xl border border-[#EDEDED] bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div class="mb-3 flex items-start justify-between gap-3">
              <div class="flex items-center gap-2.5">
                <span
                  class="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-[#D1FAE5] bg-[#ECFDF5] dark:border-emerald-500/30 dark:bg-emerald-500/10"
                >
                  <CircleCheck class="size-3.5 text-[#22C55E] dark:text-emerald-400" />
                </span>
                <div class="min-w-0">
                  <h3 class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-100">
                    {{ t('public.models.detail.health') }}
                  </h3>
                  <p class="text-xs text-[#A3A3A3] dark:text-neutral-500">
                    {{ t('public.models.detail.healthDesc') }}
                  </p>
                </div>
              </div>
              <div
                role="group"
                :aria-label="t('public.models.detail.health')"
                class="inline-flex shrink-0 gap-1 rounded-full border border-[#EDEDED] bg-[#F5F5F5] p-0.5 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <button
                  v-for="h in [24, 168]"
                  :key="h"
                  type="button"
                  :aria-pressed="hours === h"
                  class="rounded-full px-3 py-1 text-xs font-medium leading-4 transition-colors"
                  :class="
                    hours === h
                      ? 'bg-white text-[#0A0A0A] shadow-[0px_1px_4px_rgba(0,0,0,0.12)] dark:bg-neutral-800 dark:text-neutral-50'
                      : 'text-[#525252] hover:text-[#0A0A0A] dark:text-neutral-400 dark:hover:text-neutral-100'
                  "
                  @click="hours = h"
                >
                  {{ h === 24 ? t('public.models.detail.hours24') : t('public.models.detail.hours168') }}
                </button>
              </div>
            </div>

            <p class="mb-3 text-xs text-[#737373] dark:text-neutral-400">
              {{ t('public.models.detail.healthOverview') }}
            </p>

            <div
              v-if="healthQ.isLoading.value"
              class="rounded-lg border border-[#E5E5E5] p-6 text-center text-sm dark:border-neutral-800"
            >
              <span class="mt-1 block text-[#737373] dark:text-neutral-400">…</span>
            </div>

            <div
              v-else-if="!showHealth"
              class="rounded-lg border border-[#E5E5E5] p-6 text-center text-sm text-[#737373] dark:border-neutral-800 dark:text-neutral-400"
            >
              {{ t('public.models.detail.noHealth') }}
            </div>

            <template v-else>
              <div class="space-y-3">
                <div v-for="row in healthRows" :key="row.group" class="flex items-center gap-2.5">
                  <span
                    class="w-20 shrink-0 truncate text-xs font-medium text-[#0A0A0A] dark:text-neutral-100"
                    :title="row.group"
                  >
                    {{ row.group }}
                  </span>
                  <span class="inline-flex gap-[3px]">
                    <span
                      v-for="b in row.buckets"
                      :key="b.ts"
                      class="group/tt relative inline-flex h-7 min-w-3 flex-1 items-center justify-center rounded-[3px]"
                      :class="toneOf(b.successRate, b.requestCount > 0).bg"
                    >
                      <span
                        class="pointer-events-none absolute bottom-9 z-30 w-max max-w-[220px] whitespace-normal break-words rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-xs font-normal leading-5 text-[#181818] shadow-lg opacity-0 transition-opacity group-hover/tt:opacity-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                      >
                        <span class="font-medium">{{ b.range }}</span>
                        <span class="mx-1 text-[#A3A3A3]">·</span>{{ row.group }}
                        <br />
                        {{ b.status }} ·
                        {{ t('public.models.detail.successShort') }} {{ b.successCount }} ·
                        {{ t('public.models.detail.failShort') }} {{ b.fail }} ·
                        {{ t('public.models.detail.errorShort') }} {{ b.errorRate }}
                      </span>
                    </span>
                  </span>
                  <span class="w-14 shrink-0 text-right text-xs tabular-nums text-[#525252] dark:text-neutral-400">
                    <template v-if="row.requests > 0">{{ row.successRate.toFixed(1) }}%</template>
                    <template v-else>{{ t('public.models.detail.noData') }}</template>
                  </span>
                </div>
              </div>

              <!-- 健康图例：6 档错误率 -->
              <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  v-for="item in legendItems"
                  :key="item.binKey"
                  class="inline-flex items-center gap-1.5 text-xs text-[#525252] dark:text-neutral-400"
                >
                  <span class="size-3 shrink-0 rounded-[3px]" :class="item.bg"></span>
                  {{ item.label }}
                </span>
              </div>
            </template>
          </section>

          <!-- API 端点 -->
          <section
            class="mt-4 rounded-xl border border-[#EDEDED] bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div class="mb-3 flex items-center gap-2.5">
              <span
                class="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-[#F3E8FF] bg-[#FAF5FF] dark:border-purple-500/30 dark:bg-purple-500/10"
              >
                <Wrench class="size-3.5 text-[#A855F7] dark:text-purple-400" />
              </span>
              <div class="min-w-0">
                <h3 class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-100">
                  {{ t('public.models.detail.api') }}
                </h3>
                <p class="text-xs text-[#A3A3A3] dark:text-neutral-500">
                  {{ t('public.models.detail.apiDesc') }}
                </p>
              </div>
            </div>
            <div class="space-y-1.5">
              <div
                v-for="e in endpoints"
                :key="e.type"
                class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#EDEDED] bg-[#FAFAFA] px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/60"
              >
                <span class="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0A0A0A] dark:text-neutral-100">
                  <span class="size-1.5 rounded-full bg-[#22C55E] dark:bg-emerald-400"></span>
                  {{ e.type }}:
                </span>
                <span class="min-w-0 flex-1 truncate font-mono text-sm text-[#525252] dark:text-neutral-300">{{ e.path }}</span>
                <span
                  class="shrink-0 rounded-md border border-[#EDEDED] bg-white px-1.5 py-0.5 text-xs font-medium text-[#525252] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-300"
                >
                  {{ e.method }}
                </span>
              </div>
            </div>
            <p
              v-if="!endpoints.length"
              class="rounded-lg border border-[#E5E5E5] p-4 text-center text-sm text-[#737373] dark:border-neutral-800 dark:text-neutral-400"
            >
              {{ t('public.models.detail.noEndpoint') }}
            </p>
          </section>

          <!-- 分组价格 -->
          <section
            class="mt-4 rounded-xl border border-[#EDEDED] bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950"
          >
            <div class="mb-3 flex items-center gap-2.5">
              <span
                class="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-[#FEF3C7] bg-[#FFFBEB] dark:border-amber-500/30 dark:bg-amber-500/10"
              >
                <Coins class="size-3.5 text-[#F59E0B] dark:text-amber-400" />
              </span>
              <div class="min-w-0">
                <h3 class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-100">
                  {{ t('public.models.detail.price') }}
                </h3>
                <p class="text-xs text-[#A3A3A3] dark:text-neutral-500">
                  {{ t('public.models.detail.priceDesc') }}
                </p>
              </div>
            </div>

            <div
              v-if="inheritChain.length"
              class="mb-3 flex flex-wrap items-center gap-1 text-xs text-[#737373] dark:text-neutral-400"
            >
              <span class="font-medium text-[#181818] dark:text-neutral-200">
                {{ t('public.models.detail.inherit') }}
              </span>
              <span class="text-[#A3A3A3]">→</span>
              <template v-for="(g, i) in inheritChain" :key="g">
                <span
                  class="inline-flex items-center rounded-md border border-[#E5E5E5] bg-[#F5F5F5] px-2 py-0.5 text-xs font-medium text-[#18181B] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
                >
                  {{ g }}
                </span>
                <span v-if="i < inheritChain.length - 1" class="text-[#A3A3A3]">→</span>
              </template>
            </div>
            <span
              v-else
              class="mb-3 inline-block text-xs text-[#A3A3A3] dark:text-neutral-600"
            >
              {{ t('public.models.detail.noInherit') }}
            </span>

            <div v-if="priceRows.length" class="overflow-hidden rounded-lg border border-[#EDEDED] dark:border-neutral-800">
              <table class="w-full border-collapse text-left">
                <thead>
                  <tr class="border-b border-[#EDEDED] bg-[#FAFAFA] dark:border-neutral-800 dark:bg-neutral-900/60">
                    <th class="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[#A3A3A3] dark:text-neutral-500">
                      {{ t('public.models.detail.colGroup') }}
                    </th>
                    <th class="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[#A3A3A3] dark:text-neutral-500">
                      {{ t('public.models.detail.colRatio') }}
                    </th>
                    <th class="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[#A3A3A3] dark:text-neutral-500">
                      {{ t('public.models.detail.colBill') }}
                    </th>
                    <th class="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-[#A3A3A3] dark:text-neutral-500">
                      {{ t('public.models.detail.colSummary') }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in priceRows"
                    :key="row.group"
                    class="border-b border-[#EDEDED] last:border-b-0 dark:border-neutral-800/70"
                  >
                    <td class="whitespace-nowrap px-3 py-2.5 text-sm font-medium text-[#0A0A0A] dark:text-neutral-100">
                      {{ row.group }}
                      <span v-if="row.desc" class="pl-1.5 text-xs font-normal text-[#9CA3AF] dark:text-neutral-500">
                        {{ row.desc }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2.5 text-sm tabular-nums text-[#525252] dark:text-neutral-300">
                      <span
                        class="inline-flex h-6 items-center justify-center rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-2.5 text-xs font-semibold text-[#3B82F6] dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
                      >
                        {{ Number.isInteger(row.ratio) ? row.ratio : row.ratio.toFixed(1) }}x
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2.5 text-sm">
                      <span
                        class="inline-flex h-6 items-center justify-center rounded-md border border-[#FEF3C7] bg-[#FFFBEB] px-2 text-xs font-medium text-[#D97706] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                      >
                        {{ row.label }}
                      </span>
                    </td>
                    <td class="whitespace-nowrap px-3 py-2.5 text-right text-sm tabular-nums text-[#0A0A0A] dark:text-neutral-100">
                      <template v-if="billingKind === 'call'">
                        <div>
                          <span class="font-mono">{{ row.input }}</span>
                          <span class="pl-0.5 text-[10px] text-[#9CA3AF] dark:text-neutral-500">/{{ t('public.models.detail.priceUnit') }}</span>
                        </div>
                      </template>
                      <template v-else>
                        <div>
                          <span class="text-xs text-[#9CA3AF] dark:text-neutral-500">{{ t('public.models.detail.priceInput') }}</span>
                          <span class="font-mono"> {{ row.input }}</span>
                          <span class="pl-0.5 text-[10px] text-[#9CA3AF] dark:text-neutral-500">/{{ t('public.models.detail.priceUnit') }}</span>
                        </div>
                        <div>
                          <span class="text-xs text-[#9CA3AF] dark:text-neutral-500">{{ t('public.models.detail.priceOutput') }}</span>
                          <span class="font-mono"> {{ row.output }}</span>
                          <span class="pl-0.5 text-[10px] text-[#9CA3AF] dark:text-neutral-500">/{{ t('public.models.detail.priceUnit') }}</span>
                        </div>
                        <div v-if="billingKind === 'token' && row.cache">
                          <span class="text-xs text-[#9CA3AF] dark:text-neutral-500">{{ t('public.models.detail.priceCache') }}</span>
                          <span class="font-mono"> {{ row.cache }}</span>
                          <span class="pl-0.5 text-[10px] text-[#9CA3AF] dark:text-neutral-500">/{{ t('public.models.detail.priceUnit') }}</span>
                        </div>
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              v-else
              class="rounded-lg border border-[#E5E5E5] p-4 text-center text-sm text-[#737373] dark:border-neutral-800 dark:text-neutral-400"
            >
              {{ t('public.models.detail.noEnableGroup') }}
            </p>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 抽屉自右滑入 */
.anim-drawer-in {
  animation: drawer-in 0.18s ease-out;
}
@keyframes drawer-in {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
</style>
