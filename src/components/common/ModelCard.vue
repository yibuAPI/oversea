<script setup lang="ts">
/**
 * 单张模型卡 —— 公开 /models 页面的网格卡与列表卡共用同一份数据体。
 *
 * layout="grid"  竖卡（默认）：厂商行 → 标题+复制 → 标签 → 描述 3 行 → Input/Output 价
 *                底栏（计费类型 | 分组徽章），hover 浮现右上「立即使用」。
 * layout="list"  横条：左侧厂商/标题/标签/描述，右侧 Input/Output 价，
 *                底栏同网格卡，整体比网格卡矮。
 *
 * 价格计算（ratio 货币化）由父组件传入 groupRatio，这里只做展示层格式化。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { Copy, Check, ArrowRight, Boxes } from 'lucide-vue-next'
import { inputPrice, outputPrice } from '@/api/models'
import type { ModelSummary, PricingModel } from '@/api/types'
import BrandIcon from '@/components/common/BrandIcon.vue'

const props = withDefaults(
  defineProps<{
    model: PricingModel
    vendorName: string
    icon: string | null
    groupRatio: number
    copied: boolean
    layout?: 'grid' | 'list'
    /** 性能指标汇总（可能没有 —— 后端未采集或该模型无数据） */
    metric?: ModelSummary
  }>(),
  { layout: 'grid', metric: undefined },
)

const emit = defineEmits<{ copy: [name: string] }>()

const { t, locale } = useI18n()

/** 列表分隔符：中文（及 CJK）用顿号，其余用逗号 */
const joinList = (items: string[]) => items.join(locale.value === 'zh-CN' ? '、' : ', ')

const tagsOf = computed(() =>
  (props.model.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean),
)

const groupCount = computed(() =>
  Array.isArray(props.model.enable_groups) ? props.model.enable_groups.length : 0,
)

/** 分组键列表：优先展示 default，其余按名称排，用于底栏悬停提示 */
const groupList = computed(() =>
  [...(props.model.enable_groups ?? [])].sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b),
  ),
)

type BillKind = 'token' | 'call' | 'tiered'
/**
 * 计费类型判定：后端动态计费走 billing_mode=tiered_expr（按表达式/时段/参数动态定价），
 * 与 quota_type 是两条并行的信号 —— 动态模型往往 quota_type 仍为 0，故需优先判 billing_mode，
 * 否则会被误标成「按 token 计费」。回退再读 quota_type（0 按 token / 1 按次 / 2 阶梯）。
 */
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

/**
 * 计费类型配色：按 token（蓝）/ 按次（紫）/ 阶梯（绿）三种色相区分，
 * 让底栏计费类型一眼可辨。显式定义浅底 + 深字 + 暗色互补，避免踩主题色。
 */
const billingTone = computed(() => {
  switch (billingKind.value) {
    case 'call':
      return {
        badge:
          'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900',
        dot: 'bg-purple-500 dark:bg-purple-400',
      }
    case 'tiered':
      return {
        badge:
          'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
        dot: 'bg-emerald-500 dark:bg-emerald-400',
      }
    default:
      return {
        badge:
          'bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
        dot: 'bg-sky-500 dark:bg-sky-400',
      }
  }
})

/** 能力点：把 supported_endpoint_types 映射成可读标签 */
const capOf = computed(() => {
  const map: Record<string, string> = {
    chat: t('models.endpointChat'),
    completions: t('models.endpointChat'),
    embeddings: t('models.endpointEmbed'),
    image: t('models.endpointImage'),
    audio: t('models.endpointAudio'),
    vision: t('models.endpointVision'),
    rerank: t('models.endpointRerank'),
  }
  return (props.model.supported_endpoint_types ?? [])
    .map((k) => map[k] ?? k)
    .filter((v, i, a) => v && a.indexOf(v) === i)
})

/** 描述兜底：没有 description 时用「厂商 + 计费 + 能力」拼一句 */
const descOf = computed(() => {
  if (props.model.description) return props.model.description
  const caps = capOf.value
  const capsText = caps.length ? joinList(caps) : t('models.endpointChat')
  return t('models.descFallback', {
    vendor: props.vendorName,
    billing: billingLabel.value,
    caps: capsText,
  })
})

const fmtPrice = (v: number) => `$${v < 1 ? +v.toFixed(3) : +v.toFixed(2)}`

const price = computed(() => {
  if (billingKind.value === 'call') {
    return {
      kind: 'call' as const,
      input: `$${props.model.model_price.toFixed(props.model.model_price < 0.01 ? 5 : 3)}`,
      output: null as string | null,
    }
  }
  if (billingKind.value === 'tiered') {
    // 动态计费（billing_mode=tiered_expr）背后仍是按 token 计量，且带真实的基础倍率
    // model_ratio/completion_ratio —— 可以像按量计费一样给出基础单价。真正的动态部分
    //（时段/参数倍率）在调用时叠加，故价签前加「起」以示是基础价。
    return {
      kind: 'tiered' as const,
      input: fmtPrice(inputPrice(props.model.model_ratio, props.groupRatio)),
      output: fmtPrice(
        outputPrice(props.model.model_ratio, props.model.completion_ratio, props.groupRatio),
      ),
    }
  }
  return {
    kind: 'token' as const,
    input: fmtPrice(inputPrice(props.model.model_ratio, props.groupRatio)),
    output: fmtPrice(
      outputPrice(props.model.model_ratio, props.model.completion_ratio, props.groupRatio),
    ),
  }
})

/**
 * 性能指标展示值：延迟 ms→s（≥1000ms 换算），吞吐取整 + "t"，
 * 成功率前端按 0~1 小数乘 100 得百分数。无数据返回 null，卡片静默隐藏该块。
 */
const metricFmt = computed(() => {
  const m = props.metric
  if (!m) return null
  const latency =
    m.avg_latency_ms >= 1000
      ? `${(m.avg_latency_ms / 1000).toFixed(1).replace(/\.0$/, '')}s`
      : `${Math.round(m.avg_latency_ms)}ms`
  return {
    latency: `${latency}`,
    throughput: `${Math.round(m.avg_tps)}t`,
    status: `${Math.round(m.success_rate * 100)}%`,
  }
})

/** 状态配色：按成功率 优/中/差 三档（命中任一即用） */
const statusTone = computed(() => {
  const rate = props.metric?.success_rate ?? 0
  if (rate >= 0.99) return 'text-[#16A34A] dark:text-[#4ADE80]'
  if (rate >= 0.95) return 'text-[#F59E0B] dark:text-[#FBBF24]'
  return 'text-[#DC2626] dark:text-[#F87171]'
})
</script>

<template>
  <!-- 网格竖卡 -->
  <article
    v-if="layout === 'grid'"
    class="group relative isolate flex cursor-pointer flex-col rounded-[10px] border border-[#E5E5E5] bg-white transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-px hover:border-[#D4D4D4] hover:shadow-[0_6px_18px_rgba(15,23,42,0.06)] xl:min-h-[313px] dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-700"
  >
    <!-- 悬停浮现的黑色 CTA -->
    <RouterLink
      to="/console"
      class="pointer-events-none absolute right-5 top-14 z-20 flex h-9 items-center gap-1.5 rounded-md bg-[#181818] px-4 text-sm font-semibold leading-5 text-white opacity-0 shadow-[0_3px_10px_rgba(0,0,0,0.16)] transition-[opacity,background-color] duration-200 hover:bg-black group-hover:pointer-events-auto group-hover:opacity-100 dark:bg-white dark:text-[#0A0A0A]"
    >
      {{ t('public.models.viewIt') }}
      <ArrowRight class="size-4" />
    </RouterLink>

    <div class="grid flex-1 gap-4 px-6 pb-4 pt-6" style="grid-template-rows: auto minmax(0, 1fr) auto">
      <div class="flex flex-col gap-2">
        <!-- 厂商行 -->
        <div class="flex min-h-6 w-fit max-w-full items-start gap-2 self-start">
          <span
            class="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[4.5px] border border-[#EDEDED] bg-white p-0.5 dark:border-neutral-700"
          >
            <BrandIcon :icon="icon" :name="vendorName" variant="light" />
          </span>
          <span
            class="min-w-0 max-w-full whitespace-normal break-words text-sm font-normal leading-6 text-[#0A0A0A] dark:text-neutral-200"
          >
            {{ vendorName }}
          </span>
        </div>

        <!-- 标题 + 悬停复制 -->
        <div class="flex min-w-0 items-center gap-1.5">
          <h3
            class="line-clamp-1 min-w-0 text-[20px] font-semibold leading-7 text-[#0A0A0A] dark:text-neutral-50"
            :title="model.model_name"
          >
            {{ model.model_name }}
          </h3>
          <button
            type="button"
            :aria-label="t('models.copyName')"
            class="pointer-events-none inline-flex size-5 shrink-0 items-center justify-center rounded text-[#8A8A8A] opacity-0 transition-[opacity,background-color,color] duration-200 hover:bg-[#F5F5F5] hover:text-[#0A0A0A] group-hover:pointer-events-auto group-hover:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            @click.stop="emit('copy', model.model_name)"
          >
            <Check v-if="copied" class="size-4 text-success-fg" />
            <Copy v-else class="size-4" />
          </button>
        </div>

        <!-- 标签：首个彩色，其余灰底描边 -->
        <div v-if="tagsOf.length" class="flex max-h-[82px] flex-wrap items-start gap-1.5 overflow-hidden pt-1">
          <span
            class="inline-flex h-[22px] items-center justify-center gap-1.5 rounded-md bg-[#E5F3FF] px-2 text-xs font-medium leading-4 text-[#1687E8] dark:bg-[#0d2a45] dark:text-[#57b3ff]"
          >
            {{ tagsOf[0] }}
          </span>
          <span
            v-for="tag in tagsOf.slice(1, 5)"
            :key="tag"
            class="inline-flex h-[22px] items-center justify-center gap-1.5 rounded-md border border-[#EDEDED] bg-[#F5F5F5] px-2 text-xs font-medium leading-4 text-[#18181B] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {{ tag }}
          </span>
        </div>
      </div>

      <!-- 描述：3 行截断，无说明时兜底成「厂商 + 计费 + 能力」 -->
      <p
        class="line-clamp-3 min-h-0 overflow-hidden text-sm font-normal leading-5 text-[#737373] dark:text-neutral-400"
      >
        {{ descOf }}
      </p>

      <!-- 性能指标：延迟 / 吞吐 / 状态。无数据时整块隐藏 -->
      <div
        v-if="metricFmt"
        class="flex items-center gap-x-4 gap-y-1 rounded-md bg-[#F5F5F5] px-2.5 py-1.5 dark:bg-neutral-900"
      >
        <span class="flex items-center gap-1.5">
          <span class="text-xs font-normal leading-4 text-[#9CA3AF]">{{ t('models.latency') }}</span>
          <span class="text-xs font-semibold leading-4 text-[#0A0A0A] dark:text-neutral-50">
            {{ metricFmt.latency }}
          </span>
        </span>
        <span class="flex items-center gap-1.5">
          <span class="text-xs font-normal leading-4 text-[#9CA3AF]">{{ t('models.throughput') }}</span>
          <span class="text-xs font-semibold leading-4 text-[#0A0A0A] dark:text-neutral-50">
            {{ metricFmt.throughput }}
          </span>
        </span>
        <span class="flex items-center gap-1.5">
          <span class="text-xs font-normal leading-4 text-[#9CA3AF]">{{ t('models.status') }}</span>
          <span class="flex items-center gap-1 text-xs font-semibold leading-4" :class="statusTone">
            <span class="size-1.5 rounded-full bg-current"></span>
            {{ metricFmt.status }}
          </span>
        </span>
      </div>

      <!-- 价格行：输入/输出合并一行；阶梯计费显示说明 -->
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <template v-if="price.kind === 'token'">
          <div class="flex items-center gap-2">
            <span class="text-sm font-normal leading-4 text-[#181818] dark:text-neutral-300">
              {{ t('models.input') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.input }}
            </span>
            <span class="text-xs font-normal text-[#9CA3AF]">
              {{ t('models.priceUnit') }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-normal leading-4 text-[#181818] dark:text-neutral-300">
              {{ t('models.output') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.output }}
            </span>
            <span class="text-xs font-normal text-[#9CA3AF]">
              {{ t('models.priceUnit') }}
            </span>
          </div>
        </template>
        <template v-else-if="price.kind === 'call'">
          <div class="flex items-center gap-2">
            <span class="text-sm font-normal leading-4 text-[#181818] dark:text-neutral-300">
              {{ t('models.perCall') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.input }}
            </span>
            <span class="text-xs font-normal text-[#9CA3AF]">
              {{ t('models.priceCallUnit') }}
            </span>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center gap-2">
            <span class="text-sm font-normal leading-4 text-[#181818] dark:text-neutral-300">
              {{ t('models.perMillionFrom') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.input }}
            </span>
            <span class="text-xs font-normal text-[#9CA3AF]">
              {{ t('models.priceUnit') }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-normal leading-4 text-[#181818] dark:text-neutral-300">
              {{ t('models.outputFrom') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.output }}
            </span>
            <span class="text-xs font-normal text-[#9CA3AF]">
              {{ t('models.priceUnit') }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <!-- 底栏 -->
    <div
      class="grid min-h-12 shrink-0 grid-cols-1 items-center gap-2 border-t border-[#EDEDED] px-6 py-3 sm:grid-cols-[minmax(120px,1fr)_auto] sm:gap-4 dark:border-neutral-800"
    >
      <span
        class="inline-flex min-w-0 items-center gap-1.5 justify-self-start rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4"
        :class="billingTone.badge"
      >
        <span class="size-1.5 shrink-0 rounded-full" :class="billingTone.dot"></span>
        <span class="truncate whitespace-nowrap">{{ billingLabel }}</span>
      </span>
      <span
        v-if="groupCount"
        class="group/badge relative flex min-w-0 items-center justify-self-end"
      >
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#E5E5E5] bg-[#F5F5F5] px-2.5 py-0.5 text-xs font-medium leading-4 text-[#18181B] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <Boxes class="size-3 text-[#737373] dark:text-neutral-500" />
          {{ t('public.models.availableGroups', { n: groupCount }) }}
        </span>
        <span
          class="pointer-events-none absolute bottom-7 right-0 z-30 hidden w-max max-w-[240px] rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-xs font-normal leading-5 text-[#181818] shadow-lg group-hover/badge:block dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          {{ joinList(groupList) }}
        </span>
      </span>
    </div>
  </article>

  <!-- 列表横条 -->
  <article
    v-else
    class="group relative isolate flex cursor-pointer flex-col rounded-[10px] border border-[#E5E5E5] bg-white transition-[background-color,border-color,box-shadow] duration-200 ease-out hover:border-[#D4D4D4] hover:shadow-[0_4px_14px_rgba(15,23,42,0.05)] dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-700"
  >
    <div class="flex min-w-0 flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:gap-8">
      <!-- 左：厂商 / 标题 / 标签 / 描述 -->
      <div class="min-w-0 flex-1">
        <div class="flex min-h-6 items-center gap-2">
          <span
            class="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-[4.5px] border border-[#EDEDED] bg-white p-0.5 dark:border-neutral-700"
          >
            <BrandIcon :icon="icon" :name="vendorName" variant="light" />
          </span>
          <span class="min-w-0 truncate text-sm font-normal leading-6 text-[#0A0A0A] dark:text-neutral-200">
            {{ vendorName }}
          </span>
        </div>

        <div class="mt-1 flex min-w-0 items-center gap-1.5">
          <h3
            class="line-clamp-1 min-w-0 text-[18px] font-semibold leading-6 text-[#0A0A0A] dark:text-neutral-50"
            :title="model.model_name"
          >
            {{ model.model_name }}
          </h3>
          <button
            type="button"
            :aria-label="t('models.copyName')"
            class="pointer-events-none inline-flex size-5 shrink-0 items-center justify-center rounded text-[#8A8A8A] opacity-0 transition-[opacity,background-color,color] duration-200 hover:bg-[#F5F5F5] hover:text-[#0A0A0A] group-hover:pointer-events-auto group-hover:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            @click.stop="emit('copy', model.model_name)"
          >
            <Check v-if="copied" class="size-4 text-success-fg" />
            <Copy v-else class="size-4" />
          </button>
        </div>

        <!-- 标签 -->
        <div v-if="tagsOf.length" class="mt-1.5 flex flex-wrap items-start gap-1.5">
          <span
            class="inline-flex h-[22px] items-center justify-center gap-1.5 rounded-md bg-[#E5F3FF] px-2 text-xs font-medium leading-4 text-[#1687E8] dark:bg-[#0d2a45] dark:text-[#57b3ff]"
          >
            {{ tagsOf[0] }}
          </span>
          <span
            v-for="tag in tagsOf.slice(1, 5)"
            :key="tag"
            class="inline-flex h-[22px] items-center justify-center gap-1.5 rounded-md border border-[#EDEDED] bg-[#F5F5F5] px-2 text-xs font-medium leading-4 text-[#18181B] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
          >
            {{ tag }}
          </span>
        </div>

        <!-- 描述 -->
        <p
          class="mt-2 line-clamp-2 text-sm font-normal leading-5 text-[#737373] dark:text-neutral-400"
        >
          {{ descOf }}
        </p>
      </div>

      <!-- 右：价格 -->
      <div class="shrink-0 border-t border-[#EDEDED] pt-3 lg:w-[176px] lg:border-t-0 lg:pt-0 dark:border-neutral-800">
        <template v-if="price.kind === 'token'">
          <div class="flex items-center justify-between gap-3 lg:justify-start lg:gap-6">
            <div class="flex items-center gap-2">
              <span class="text-xs font-normal leading-4 text-[#181818] dark:text-neutral-300">
                {{ t('models.input') }}
              </span>
              <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
                {{ price.input }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-normal leading-4 text-[#181818] dark:text-neutral-300">
                {{ t('models.output') }}
              </span>
              <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
                {{ price.output }}
              </span>
            </div>
            <span class="text-xs font-normal text-[#9CA3AF]">{{ t('models.priceUnit') }}</span>
          </div>
        </template>
        <template v-else-if="price.kind === 'call'">
          <div class="flex items-center justify-between gap-3 lg:justify-start lg:gap-6">
            <span class="text-xs font-normal leading-4 text-[#181818] dark:text-neutral-300">
              {{ t('models.perCall') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.input }}
            </span>
            <span class="text-xs font-normal text-[#9CA3AF]">{{ t('models.priceCallUnit') }}</span>
          </div>
        </template>
        <template v-else>
          <div class="flex items-center justify-between gap-3 lg:justify-start lg:gap-6">
            <span class="text-xs font-normal leading-4 text-[#181818] dark:text-neutral-300">
              {{ t('models.perMillionFrom') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.input }}
            </span>
            <span class="text-xs font-normal text-[#181818] dark:text-neutral-300">
              {{ t('models.outputFrom') }}
            </span>
            <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
              {{ price.output }}
            </span>
            <span class="text-xs font-normal text-[#9CA3AF]">{{ t('models.priceUnit') }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- 性能指标：延迟 / 吞吐 / 状态。无数据时整块隐藏 -->
    <div
      v-if="metricFmt"
      class="flex items-center gap-x-4 gap-y-1 border-t border-[#EDEDED] px-5 py-2 dark:border-neutral-800"
    >
      <span class="flex items-center gap-1.5">
        <span class="text-xs font-normal leading-4 text-[#9CA3AF]">{{ t('models.latency') }}</span>
        <span class="text-xs font-semibold leading-4 text-[#0A0A0A] dark:text-neutral-50">
          {{ metricFmt.latency }}
        </span>
      </span>
      <span class="flex items-center gap-1.5">
        <span class="text-xs font-normal leading-4 text-[#9CA3AF]">{{ t('models.throughput') }}</span>
        <span class="text-xs font-semibold leading-4 text-[#0A0A0A] dark:text-neutral-50">
          {{ metricFmt.throughput }}
        </span>
      </span>
      <span class="flex items-center gap-1.5">
        <span class="text-xs font-normal leading-4 text-[#9CA3AF]">{{ t('models.status') }}</span>
        <span class="flex items-center gap-1 text-xs font-semibold leading-4" :class="statusTone">
          <span class="size-1.5 rounded-full bg-current"></span>
          {{ metricFmt.status }}
        </span>
      </span>
    </div>

    <!-- 底栏 -->
    <div
      class="grid min-h-10 shrink-0 grid-cols-1 items-center gap-2 border-t border-[#EDEDED] px-5 py-2 sm:grid-cols-[minmax(120px,1fr)_auto] sm:gap-4 dark:border-neutral-800"
    >
      <span
        class="inline-flex min-w-0 items-center gap-1.5 justify-self-start rounded-full border px-2.5 py-0.5 text-xs font-medium leading-4"
        :class="billingTone.badge"
      >
        <span class="size-1.5 shrink-0 rounded-full" :class="billingTone.dot"></span>
        <span class="truncate whitespace-nowrap">{{ billingLabel }}</span>
      </span>
      <span
        v-if="groupCount"
        class="group/badge relative flex min-w-0 items-center justify-self-end"
      >
        <span
          class="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#E5E5E5] bg-[#F5F5F5] px-2.5 py-0.5 text-xs font-medium leading-4 text-[#18181B] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
        >
          <Boxes class="size-3 text-[#737373] dark:text-neutral-500" />
          {{ t('public.models.availableGroups', { n: groupCount }) }}
        </span>
        <span
          class="pointer-events-none absolute bottom-7 right-0 z-30 hidden w-max max-w-[240px] rounded-lg border border-[#E5E5E5] bg-white px-3 py-2 text-xs font-normal leading-5 text-[#181818] shadow-lg group-hover/badge:block dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
        >
          {{ joinList(groupList) }}
        </span>
      </span>
    </div>
  </article>
</template>
