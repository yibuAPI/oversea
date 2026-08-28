<script setup lang="ts">
/**
 * 模型表格 —— 公开 /models 的「列表」视图（网格视图仍用 ModelCard 竖卡）。
 *
 * 列：模型（图标+名，悬停复制）| 类型 | 价格（输入/输出）| 缓存 |
 *     供应商（图标+名）| 标签 | 端点 | 分组
 *
 * 排版取向与卡片相反 —— 一行一模型、列对齐，便于横向比价；
 * 描述/性能指标不进表格（信息密度优先），需要细节回网格视图看。
 *
 * 价格计算（ratio → 美元）由父组件传入 groupRatio，这里只做展示层格式化。
 * 端点/分组两列是**枚举值上色**：同一个值在整张表里恒定同色，靠名字哈希取
 * 固定色板，避免每次渲染跳色，也免去为每个新分组手工配色。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Check } from 'lucide-vue-next'
import { inputPrice, outputPrice } from '@/api/models'
import type { PricingModel } from '@/api/types'
import BrandIcon from '@/components/common/BrandIcon.vue'

const props = defineProps<{
  models: PricingModel[]
  groupRatio: number
  /** 已复制的模型名（父级统一维护，保证同一时间只有一行显示对勾） */
  copied: string | null
  /** 模型 → 厂商名，父级已处理「其他」兜底 */
  vendorName: (id?: number) => string
  /** 模型 → 图标名，模型自带优先、否则取厂商的 */
  iconOf: (m: PricingModel) => string | null
}>()

const emit = defineEmits<{ copy: [name: string] }>()

const { t } = useI18n()

type BillKind = 'token' | 'call' | 'tiered'
/**
 * 计费类型判定：动态计费走 billing_mode="tiered_expr"，与 quota_type 并行 ——
 * 动态模型的 quota_type 常仍是 0，必须优先判 billing_mode，否则会误标成按 token。
 * 与 ModelCard / ModelsPage 的判定保持一致。
 */
const billingKind = (m: PricingModel): BillKind =>
  m.billing_mode === 'tiered_expr'
    ? 'tiered'
    : m.quota_type === 1
      ? 'call'
      : m.quota_type === 2
        ? 'tiered'
        : 'token'

const billingLabel = (m: PricingModel) => {
  const k = billingKind(m)
  return k === 'call'
    ? t('home.latest.kindCall')
    : k === 'tiered'
      ? t('home.latest.kindTiered')
      : t('home.latest.kindToken')
}

/** 计费类型配色：按 token 蓝 / 按次 紫 / 动态 橙，与卡片底栏同一套色相语义 */
const billingTone = (m: PricingModel) => {
  switch (billingKind(m)) {
    case 'call':
      return 'text-purple-600 dark:text-purple-400'
    case 'tiered':
      return 'text-amber-600 dark:text-amber-400'
    default:
      return 'text-sky-600 dark:text-sky-400'
  }
}

/** 小数位：不足 1 美元多留几位，避免把 $0.0033 显示成 $0.00 */
const fmtPrice = (v: number) =>
  `$${v >= 1 ? +v.toFixed(3) : v >= 0.001 ? +v.toFixed(4) : +v.toFixed(6)}`

/** 价格列：按次只有单价，其余是「输入 / 输出」两档 */
const priceOf = (m: PricingModel) => {
  if (billingKind(m) === 'call') {
    return { kind: 'call' as const, input: fmtPrice(m.model_price), output: null }
  }
  return {
    kind: 'token' as const,
    input: fmtPrice(inputPrice(m.model_ratio, props.groupRatio)),
    output: fmtPrice(outputPrice(m.model_ratio, m.completion_ratio, props.groupRatio)),
  }
}

/**
 * 缓存价 = 输入价 × cache_ratio。后端没配 cache_ratio 的模型不支持缓存计价，
 * 显示破折号而不是 $0 —— 两者含义完全不同。按次计费同样没有缓存概念。
 */
const cacheOf = (m: PricingModel) => {
  if (billingKind(m) === 'call' || typeof m.cache_ratio !== 'number') return null
  return fmtPrice(inputPrice(m.model_ratio, props.groupRatio) * m.cache_ratio)
}

const tagsOf = (m: PricingModel) =>
  (m.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** 分组：default 置顶，其余按名称排 —— 与筛选侧栏的顺序一致 */
const groupsOf = (m: PricingModel) =>
  [...(m.enable_groups ?? [])].sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b),
  )

/** 枚举值上色：名字哈希取固定色板，同名恒同色（端点、分组共用） */
const TOKEN_TONES = [
  'text-sky-600 dark:text-sky-400',
  'text-violet-600 dark:text-violet-400',
  'text-amber-600 dark:text-amber-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-rose-600 dark:text-rose-400',
  'text-cyan-600 dark:text-cyan-400',
]
function toneOf(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  return TOKEN_TONES[Math.abs(h) % TOKEN_TONES.length]
}

/** 每行预算：端点最多 2 个、分组最多 2 个，其余折成 +N（悬停出完整列表） */
const MAX_INLINE = 2

const rows = computed(() =>
  props.models.map((m) => {
    const groups = groupsOf(m)
    const endpoints = m.supported_endpoint_types ?? []
    return {
      model: m,
      name: m.model_name,
      icon: props.iconOf(m),
      vendor: props.vendorName(m.vendor_id),
      billing: { label: billingLabel(m), tone: billingTone(m) },
      price: priceOf(m),
      cache: cacheOf(m),
      tags: tagsOf(m),
      endpoints: endpoints.slice(0, MAX_INLINE),
      endpointsMore: Math.max(0, endpoints.length - MAX_INLINE),
      endpointsAll: endpoints.join('、'),
      groups: groups.slice(0, MAX_INLINE),
      groupsMore: Math.max(0, groups.length - MAX_INLINE),
      groupsAll: groups.join('、'),
    }
  }),
)
</script>

<template>
  <!-- 横向滚动容器：窄屏不压缩列宽，整表左右滑动 -->
  <div
    class="overflow-x-auto rounded-[10px] border border-[#E5E5E5] bg-white dark:border-neutral-800 dark:bg-neutral-950"
  >
    <table class="w-full min-w-[1040px] border-collapse text-left">
      <thead>
        <tr class="border-b border-[#E5E5E5] bg-[#FAFAFA] dark:border-neutral-800 dark:bg-neutral-900/60">
          <th
            v-for="col in [
              { key: 'model', label: t('public.models.colModel'), w: 'w-[22%]' },
              { key: 'type', label: t('public.models.colType'), w: 'w-[9%]' },
              { key: 'price', label: t('public.models.colPrice'), w: 'w-[13%]' },
              { key: 'cache', label: t('public.models.colCache'), w: 'w-[10%]' },
              { key: 'provider', label: t('public.models.colProvider'), w: 'w-[11%]' },
              { key: 'tags', label: t('public.models.colTags'), w: 'w-[11%]' },
              { key: 'endpoint', label: t('public.models.colEndpoint'), w: 'w-[11%]' },
              { key: 'group', label: t('public.models.colGroup'), w: 'w-[13%]' },
            ]"
            :key="col.key"
            scope="col"
            class="px-4 py-3 text-sm font-medium leading-5 text-[#525252] dark:text-neutral-400"
            :class="col.w"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
          class="group border-b border-[#EDEDED] transition-colors last:border-b-0 hover:bg-[#FAFAFA] dark:border-neutral-800/70 dark:hover:bg-neutral-900/50"
        >
          <!-- 模型：图标 + 名 + 悬停复制 -->
          <td class="px-4 py-4 align-middle">
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-[#EDEDED] bg-white p-px dark:border-neutral-700"
              >
                <BrandIcon :icon="row.icon" :name="row.vendor" variant="light" />
              </span>
              <span
                class="min-w-0 truncate text-sm font-medium leading-5 text-[#0A0A0A] dark:text-neutral-50"
                :title="row.name"
              >
                {{ row.name }}
              </span>
              <button
                type="button"
                :aria-label="t('models.copyName')"
                class="pointer-events-none inline-flex size-5 shrink-0 items-center justify-center rounded text-[#8A8A8A] opacity-0 transition-[opacity,background-color,color] duration-200 hover:bg-[#F5F5F5] hover:text-[#0A0A0A] group-hover:pointer-events-auto group-hover:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                @click.stop="emit('copy', row.name)"
              >
                <Check v-if="copied === row.name" class="size-3.5 text-success-fg" />
                <Copy v-else class="size-3.5" />
              </button>
            </div>
          </td>

          <!-- 类型 -->
          <td class="px-4 py-4 align-middle">
            <span class="whitespace-nowrap text-sm font-medium leading-5" :class="row.billing.tone">
              {{ row.billing.label }}
            </span>
          </td>

          <!-- 价格：输入 / 输出（按次只有单价） -->
          <td class="px-4 py-4 align-middle">
            <div class="whitespace-nowrap text-sm font-medium leading-5 text-[#0A0A0A] dark:text-neutral-50">
              <template v-if="row.price.kind === 'token'">
                {{ row.price.input }}
                <span class="text-[#A3A3A3] dark:text-neutral-600">/</span>
                {{ row.price.output }}
              </template>
              <template v-else>{{ row.price.input }}</template>
            </div>
            <div class="whitespace-nowrap text-xs leading-4 text-[#9CA3AF]">
              {{ row.price.kind === 'token' ? t('models.priceUnit') : t('models.priceCallUnit') }}
            </div>
          </td>

          <!-- 缓存：无 cache_ratio 的模型显示破折号 -->
          <td class="px-4 py-4 align-middle">
            <template v-if="row.cache">
              <div class="whitespace-nowrap text-sm font-medium leading-5 text-[#0A0A0A] dark:text-neutral-50">
                {{ row.cache }}
              </div>
              <div class="whitespace-nowrap text-xs leading-4 text-[#9CA3AF]">
                {{ t('public.models.cacheUnit') }}
              </div>
            </template>
            <span v-else class="text-sm text-[#A3A3A3] dark:text-neutral-600">
              {{ t('public.models.cacheNone') }}
            </span>
          </td>

          <!-- 供应商 -->
          <td class="px-4 py-4 align-middle">
            <div class="flex min-w-0 items-center gap-1.5">
              <span
                class="flex size-[18px] shrink-0 items-center justify-center overflow-hidden rounded-[4px] bg-transparent"
              >
                <BrandIcon :icon="row.icon" :name="row.vendor" variant="light" />
              </span>
              <span
                class="min-w-0 truncate text-sm leading-5 text-[#0A0A0A] dark:text-neutral-200"
                :title="row.vendor"
              >
                {{ row.vendor }}
              </span>
            </div>
          </td>

          <!-- 标签 -->
          <td class="px-4 py-4 align-middle">
            <div v-if="row.tags.length" class="flex flex-wrap items-center gap-1">
              <span
                v-for="tag in row.tags.slice(0, 2)"
                :key="tag"
                class="inline-flex h-[20px] items-center rounded-md border border-[#EDEDED] bg-[#F5F5F5] px-1.5 text-xs font-medium leading-4 text-[#18181B] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {{ tag }}
              </span>
              <span
                v-if="row.tags.length > 2"
                class="text-xs text-[#9CA3AF]"
                :title="row.tags.join('、')"
              >
                {{ t('public.models.moreGroups', { n: row.tags.length - 2 }) }}
              </span>
            </div>
            <span v-else class="text-sm text-[#A3A3A3] dark:text-neutral-600">-</span>
          </td>

          <!-- 端点 -->
          <td class="px-4 py-4 align-middle">
            <div v-if="row.endpoints.length" class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                v-for="e in row.endpoints"
                :key="e"
                class="text-sm leading-5"
                :class="toneOf(e)"
              >
                {{ e }}
              </span>
              <span
                v-if="row.endpointsMore"
                class="text-xs text-[#9CA3AF]"
                :title="row.endpointsAll"
              >
                {{ t('public.models.moreGroups', { n: row.endpointsMore }) }}
              </span>
            </div>
            <span v-else class="text-sm text-[#A3A3A3] dark:text-neutral-600">-</span>
          </td>

          <!-- 分组 -->
          <td class="px-4 py-4 align-middle">
            <div v-if="row.groups.length" class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                v-for="g in row.groups"
                :key="g"
                class="max-w-[110px] truncate text-sm leading-5"
                :class="toneOf(g)"
                :title="g"
              >
                {{ g }}
              </span>
              <span v-if="row.groupsMore" class="text-xs text-[#9CA3AF]" :title="row.groupsAll">
                {{ t('public.models.moreGroups', { n: row.groupsMore }) }}
              </span>
            </div>
            <span v-else class="text-sm text-[#A3A3A3] dark:text-neutral-600">-</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
