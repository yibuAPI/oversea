<script setup lang="ts">
/**
 * 公开模型库 /models —— 逐像素对照 infron.ai/models（CDP 抓取件实测）：
 *
 *   hero      浅色渐变底 border-b #EDEDED，pt-6 pb-12 居中
 *             h1 36px/600 lh48 #0A0A0A；副题 14px/400 lh20 #737373
 *             搜索框 w-min(1280px) h-12 rounded-xl 白底 shadow 1px
 *   精选 tab  h-14 border-b-[3px]，激活黑字 semibold，图标 size-4
 *   精选卡    h-24 rounded-[10px] border #E5E5E5：左 24×24 渐变方块
 *             （135deg 品牌色→白→次色）内嵌 16×16 rounded-[18px] logo，
 *             右侧 grid-rows-[28px_28px]：名 14px/600 + 能力徽章
 *             h-[22px] rounded-[6px] bg#E5F3FF #1687E8；второй行 12px #737373
 *             轮播每页 6 张（3 列 2 行），左右圆形切页按钮
 *   分类 tab  segmented：bg#F5F5F5 rounded-[8px] p-1，激活白底
 *             shadow 0 1px 4px rgba(0,0,0,.12)
 *   正文      白底；左侧 w-64 border-r pr-8 sticky 筛选栏
 *             （Filter 16px bold；分节 border-t，可折叠；行=复选框+名+计数）
 *   网格头    「N Models」20px/600 + All Providers 按钮 + Sort : 按钮
 *   模型卡    rounded-[10px] border #E5E5E5，hover 抬升 + 阴影 +
 *             右上黑色 View It 按钮浮现；体部 px-6 pt-6 pb-4：
 *             厂商行(icon24+14px) → 标题 20px/600 + 悬停复制 → 标签
 *             h-[22px]（首个彩色，其余灰底）→ 描述 14px 3 行 →
 *             Input/Output 价（$14px/600 + /M Tokens 12px #9CA3AF）
 *             底栏 border-t px-6 py-3：计费类型 | 可用分组数
 *
 *   容器统一 max-w-[1920px] px-8 min-[1280px]:px-[77px]。
 *   暗色主题用 neutral 系对应（对照 infron 的 dark: 变体）。
 *   数据仍全部来自公开 GET /api/pricing —— 页面展示即实际结算价。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { Search, ChevronDown, ChevronUp, Boxes, LayoutGrid, List } from 'lucide-vue-next'
import { getPricing, inputPrice, getPerfMetricsSummary } from '@/api/models'
import type { ModelSummary, PricingModel } from '@/api/types'
import ModelCard from '@/components/common/ModelCard.vue'

/** 网格/列表视图：默认网格，记忆到 localStorage，切换无需经过父级状态 */
type ViewMode = 'grid' | 'list'
const view = ref<ViewMode>(
  (localStorage.getItem('onestep-models-view') as ViewMode) === 'list' ? 'list' : 'grid',
)
function setView(v: ViewMode) {
  view.value = v
  localStorage.setItem('onestep-models-view', v)
}

const { t } = useI18n()

const pricingQ = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

/** 性能指标汇总：model_name → 指标。拿不到数据时保持空 map，卡片静默隐藏指标块 */
const perfQ = useQuery({ queryKey: ['perf-metrics', 'summary'], queryFn: getPerfMetricsSummary })
const perfMap = computed<Record<string, ModelSummary>>(() => {
  const out: Record<string, ModelSummary> = {}
  for (const m of perfQ.data.value?.models ?? []) out[m.model_name] = m
  return out
})

const search = ref('')
const vendorSel = ref<Set<number>>(new Set())
type BillKind = 'token' | 'call' | 'tiered'
const billSel = ref<Set<BillKind>>(new Set())
const groupSel = ref<Set<string>>(new Set())
type SortKey = 'name' | 'priceAsc' | 'priceDesc'
const sortKey = ref<SortKey>('name')
const category = ref<string>('all')

const models = computed(() => pricingQ.data.value?.data ?? [])
const vendors = computed(() => pricingQ.data.value?.vendors ?? [])

/** 分组倍率映射：group → ratio，用于价格换算 */
const groupRatioMap = computed<Record<string, number>>(
  () => pricingQ.data.value?.group_ratio ?? {},
)
/** 默认分组倍率：优先取 default，否则取第一个数值 */
const groupRatio = computed(() => {
  const g = groupRatioMap.value
  if (typeof g.default === 'number') return g.default
  const first = Object.values(g).find((v) => typeof v === 'number')
  return typeof first === 'number' ? first : 1
})

const vendorName = (id?: number) =>
  vendors.value.find((v) => v.id === id)?.name ?? t('models.vendorOther')
/** 图标名：模型自己的 icon 优先（"OpenAI.Color" 这类 lobehub 名），否则用厂商的 */
const iconOf = (m: PricingModel) =>
  m.icon || vendors.value.find((v) => v.id === m.vendor_id)?.icon || null

const tagsOf = (m: PricingModel) =>
  (m.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)

function comparablePrice(m: PricingModel): number {
  if (billingKind(m) === 'call') return m.model_price
  if (billingKind(m) === 'tiered') return Number.POSITIVE_INFINITY // 阶梯计费没有固定单价，价格排序放最后
  return inputPrice(m.model_ratio, groupRatio.value)
}

const categories = computed(() => {
  const freq = new Map<string, number>()
  for (const m of models.value)
    for (const tag of tagsOf(m)) freq.set(tag, (freq.get(tag) ?? 0) + 1)
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag]) => tag)
})

/** 可用分组列表：以 group_ratio 的键（即后台「定价分组」配置）为准，保证与后台一致。
 *  分组即便目前没有模型（count 为 0）也列出，避免前端筛选面板和后台表格对不上。 */
const groups = computed(() => {
  return Object.keys(groupRatioMap.value)
    .map((key) => ({ key, label: key }))
    .sort((a, b) =>
      a.key === 'default' ? -1 : b.key === 'default' ? 1 : a.label.localeCompare(b.label),
    )
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = models.value.filter((m) => {
    if (vendorSel.value.size && !vendorSel.value.has(m.vendor_id ?? 0)) return false
    if (billSel.value.size) {
      const kind = billingKind(m)
      if (!billSel.value.has(kind)) return false
    }
    if (groupSel.value.size) {
      const gs = m.enable_groups ?? []
      if (!gs.some((g) => groupSel.value.has(g))) return false
    }
    if (category.value !== 'all' && !tagsOf(m).includes(category.value)) return false
    if (!q) return true
    return (
      m.model_name.toLowerCase().includes(q) ||
      (m.description ?? '').toLowerCase().includes(q) ||
      vendorName(m.vendor_id).toLowerCase().includes(q)
    )
  })
  if (sortKey.value === 'priceAsc')
    return [...list].sort((a, b) => comparablePrice(a) - comparablePrice(b))
  if (sortKey.value === 'priceDesc')
    return [...list].sort((a, b) => comparablePrice(b) - comparablePrice(a))
  return [...list].sort(
    (a, b) =>
      (a.vendor_id ?? 999) - (b.vendor_id ?? 999) ||
      a.model_name.localeCompare(b.model_name),
  )
})

const vendorCounts = computed(() => {
  const m = new Map<number, number>()
  for (const x of models.value) {
    const id = x.vendor_id ?? 0
    m.set(id, (m.get(id) ?? 0) + 1)
  }
  return m
})
const billCounts = computed(() => {
  let token = 0
  let call = 0
  let tiered = 0
  for (const m of models.value) {
    const k = billingKind(m)
    if (k === 'call') call++
    else if (k === 'tiered') tiered++
    else token++
  }
  return { token, call, tiered }
})

function toggleVendor(id: number) {
  const next = new Set(vendorSel.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  vendorSel.value = next
}
function toggleBill(kind: BillKind) {
  const next = new Set(billSel.value)
  if (next.has(kind)) next.delete(kind)
  else next.add(kind)
  billSel.value = next
}

const groupCounts = computed(() => {
  const m = new Map<string, number>()
  for (const x of models.value) {
    for (const g of x.enable_groups ?? []) m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
})

function toggleGroup(key: string) {
  const next = new Set(groupSel.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  groupSel.value = next
}

/** 侧栏分节折叠状态 */
const collapsed = ref<Record<string, boolean>>({})
const toggleSection = (k: string) => (collapsed.value[k] = !collapsed.value[k])

/**
 * 计价方式：动态计费（billing_mode="tiered_expr"，与 quota_type 并行、需优先读）→ 阶梯；
 * 否则 0 按量 / 1 按次 / 2 阶梯。页面上筛选与排序都从这里取，避免到处对 1 特判。
 */
const billingKind = (m: PricingModel): BillKind =>
  m.billing_mode === 'tiered_expr'
    ? 'tiered'
    : m.quota_type === 1
      ? 'call'
      : m.quota_type === 2
        ? 'tiered'
        : 'token'

const copied = ref<string | null>(null)
async function copyName(name: string) {
  try {
    await navigator.clipboard.writeText(name)
    copied.value = name
    setTimeout(() => (copied.value = null), 1500)
  } catch {
    /* 剪贴板不可用时静默 */
  }
}
</script>

<template>
  <div class="bg-white dark:bg-[#0a0a0b]">
    <!-- ============ hero：浅色渐变底（暗色下深灰蓝） ============ -->
    <section
      class="relative isolate overflow-hidden border-b border-[#EDEDED] bg-[radial-gradient(120%_100%_at_50%_0%,#eaf2fa_0%,#f5f9fc_40%,#ffffff_100%)] pb-12 pt-[128px] text-center lg:pt-[140px] dark:border-neutral-800 dark:bg-[linear-gradient(180deg,#232f3a_0%,#161d24_60%,#10151a_100%)]"
    >
      <div
        class="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col items-center gap-12 px-8 min-[1280px]:px-[77px]"
      >
        <div class="flex flex-col items-center gap-6 pt-6">
          <div class="flex flex-col items-center gap-4">
            <h1
              class="text-balance text-[36px] font-semibold leading-[48px] text-[#0A0A0A] dark:text-neutral-50"
            >
              {{ t('public.models.heroTitle') }}
            </h1>
            <p class="text-center text-[14px] leading-5 text-[#737373] dark:text-neutral-400">
              {{
                t('public.models.heroStats', {
                  models: models.length || '—',
                  vendors: vendors.length || '—',
                })
              }}
            </p>
          </div>

          <!-- 搜索框 -->
          <div class="w-[min(1280px,calc(100vw-64px))]">
            <div
              class="flex h-12 items-center gap-2 rounded-xl border border-[#E5E5E5] bg-white pl-3 pr-4 shadow-[0px_1px_1px_rgba(0,0,0,0.10)] transition-all duration-200 focus-within:border-[#A3A3A3] dark:border-neutral-700 dark:bg-neutral-900"
            >
              <Search class="size-4 shrink-0 text-[#737373] dark:text-neutral-400" />
              <input
                v-model="search"
                type="search"
                :placeholder="t('public.models.searchBig')"
                class="flex-1 bg-transparent text-sm font-medium leading-5 text-[#0A0A0A] outline-none placeholder:text-[#A3A3A3] dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 正文 ============ -->
    <div class="bg-white pb-16 pt-6 dark:bg-[#0a0a0b]">
      <div
        class="mx-auto flex w-full max-w-[1920px] flex-col gap-10 px-8 min-[1280px]:px-[77px]"
      >
        <section class="flex flex-col gap-6">
          <!-- 分类 segmented tab -->
          <div class="border-b border-[#E5E5E5] pb-6 dark:border-neutral-800">
            <div
              role="tablist"
              :aria-label="t('public.models.catAll')"
              class="inline-flex max-w-full gap-1 overflow-x-auto rounded-[8px] bg-[#F5F5F5] p-1 dark:bg-neutral-900"
            >
              <button
                role="tab"
                :aria-selected="category === 'all'"
                class="motion-press h-9 shrink-0 rounded-[6px] px-3 text-sm font-medium leading-5"
                :class="
                  category === 'all'
                    ? 'bg-white text-[#0A0A0A] shadow-[0px_1px_4px_rgba(0,0,0,0.12)] dark:bg-neutral-800 dark:text-neutral-50'
                    : 'text-[#525252] hover:text-[#0A0A0A] dark:text-neutral-400 dark:hover:text-neutral-100'
                "
                @click="category = 'all'"
              >
                {{ t('public.models.catAll') }}
              </button>
              <button
                v-for="c in categories"
                :key="c"
                role="tab"
                :aria-selected="category === c"
                class="motion-press h-9 shrink-0 rounded-[6px] px-3 text-sm font-medium leading-5"
                :class="
                  category === c
                    ? 'bg-white text-[#0A0A0A] shadow-[0px_1px_4px_rgba(0,0,0,0.12)] dark:bg-neutral-800 dark:text-neutral-50'
                    : 'text-[#525252] hover:text-[#0A0A0A] dark:text-neutral-400 dark:hover:text-neutral-100'
                "
                @click="category = c"
              >
                {{ c }}
              </button>
            </div>
          </div>

          <div class="flex gap-0">
            <!-- ============ 筛选侧栏 ============ -->
            <aside
              class="hidden w-64 shrink-0 self-start border-r border-[#E5E5E5] pr-8 lg:sticky lg:top-[104px] lg:block lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto dark:border-neutral-800"
            >
              <div class="flex w-full flex-col gap-0">
                <div class="flex items-center justify-between pb-4">
                  <span class="text-base font-bold text-[#0A0A0A] dark:text-neutral-50">
                    {{ t('public.models.filter') }}
                  </span>
                </div>

                <!-- 厂商 -->
                <div class="border-t border-[#E5E5E5] pt-4 dark:border-neutral-800">
                  <button
                    type="button"
                    class="motion-press flex w-full items-center justify-between pb-3"
                    @click="toggleSection('vendor')"
                  >
                    <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
                      {{ t('public.models.filterVendor') }}
                    </span>
                    <component
                      :is="collapsed.vendor ? ChevronDown : ChevronUp"
                      class="size-4 text-[#737373]"
                    />
                  </button>
                  <ul v-if="!collapsed.vendor" class="flex flex-col gap-1 pb-1">
                    <li v-for="v in vendors" :key="v.id">
                      <label
                        class="motion-press flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-[#F5F5F5] dark:hover:bg-neutral-900"
                      >
                        <input
                          type="checkbox"
                          :checked="vendorSel.has(v.id)"
                          class="size-4 shrink-0 accent-[#0A0A0A] dark:accent-white"
                          @change="toggleVendor(v.id)"
                        />
                        <span
                          class="min-w-0 flex-1 truncate text-sm font-normal text-[#0A0A0A] dark:text-neutral-200"
                        >
                          {{ v.name }}
                        </span>
                        <span
                          class="min-w-[18px] shrink-0 text-right text-sm font-normal leading-5 text-[#737373] dark:text-neutral-500"
                        >
                          {{ vendorCounts.get(v.id) ?? 0 }}
                        </span>
                      </label>
                    </li>
                  </ul>
                </div>

                <!-- 计费方式 -->
                <div class="mt-5 border-t border-[#E5E5E5] pt-4 dark:border-neutral-800">
                  <button
                    type="button"
                    class="motion-press flex w-full items-center justify-between pb-3"
                    @click="toggleSection('billing')"
                  >
                    <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
                      {{ t('public.models.filterBilling') }}
                    </span>
                    <component
                      :is="collapsed.billing ? ChevronDown : ChevronUp"
                      class="size-4 text-[#737373]"
                    />
                  </button>
                  <ul v-if="!collapsed.billing" class="flex flex-col gap-1 pb-1">
                    <li>
                      <label
                        class="motion-press flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-[#F5F5F5] dark:hover:bg-neutral-900"
                      >
                        <input
                          type="checkbox"
                          :checked="billSel.has('token')"
                          class="size-4 shrink-0 accent-[#0A0A0A] dark:accent-white"
                          @change="toggleBill('token')"
                        />
                        <span class="flex-1 text-sm text-[#0A0A0A] dark:text-neutral-200">
                          {{ t('home.latest.kindToken') }}
                        </span>
                        <span class="text-right text-sm text-[#737373] dark:text-neutral-500">
                          {{ billCounts.token }}
                        </span>
                      </label>
                    </li>
                    <li>
                      <label
                        class="motion-press flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-[#F5F5F5] dark:hover:bg-neutral-900"
                      >
                        <input
                          type="checkbox"
                          :checked="billSel.has('call')"
                          class="size-4 shrink-0 accent-[#0A0A0A] dark:accent-white"
                          @change="toggleBill('call')"
                        />
                        <span class="flex-1 text-sm text-[#0A0A0A] dark:text-neutral-200">
                          {{ t('home.latest.kindCall') }}
                        </span>
                        <span class="text-right text-sm text-[#737373] dark:text-neutral-500">
                          {{ billCounts.call }}
                        </span>
                      </label>
                    </li>
                    <li>
                      <label
                        class="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-[#F5F5F5] dark:hover:bg-neutral-900"
                      >
                        <input
                          type="checkbox"
                          :checked="billSel.has('tiered')"
                          class="size-4 shrink-0 accent-[#0A0A0A] dark:accent-white"
                          @change="toggleBill('tiered')"
                        />
                        <span class="flex-1 text-sm text-[#0A0A0A] dark:text-neutral-200">
                          {{ t('home.latest.kindTiered') }}
                        </span>
                        <span class="text-right text-sm text-[#737373] dark:text-neutral-500">
                          {{ billCounts.tiered }}
                        </span>
                      </label>
                    </li>
                  </ul>
                </div>

                <!-- 分组 -->
                <div class="mt-5 border-t border-[#E5E5E5] pt-4 dark:border-neutral-800">
                  <button
                    type="button"
                    class="motion-press flex w-full items-center justify-between pb-3"
                    @click="toggleSection('group')"
                  >
                    <span class="text-sm font-semibold text-[#0A0A0A] dark:text-neutral-50">
                      {{ t('public.models.filterGroup') }}
                    </span>
                    <component
                      :is="collapsed.group ? ChevronDown : ChevronUp"
                      class="size-4 text-[#737373]"
                    />
                  </button>
                  <ul v-if="!collapsed.group" class="flex flex-col gap-1 pb-1">
                    <li v-for="g in groups" :key="g.key">
                      <label
                        class="motion-press flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-[#F5F5F5] dark:hover:bg-neutral-900"
                      >
                        <input
                          type="checkbox"
                          :checked="groupSel.has(g.key)"
                          class="size-4 shrink-0 accent-[#0A0A0A] dark:accent-white"
                          @change="toggleGroup(g.key)"
                        />
                        <span
                          class="min-w-0 flex-1 truncate text-sm font-normal text-[#0A0A0A] dark:text-neutral-200"
                        >
                          {{ g.label }}
                        </span>
                        <span
                          class="min-w-[18px] shrink-0 text-right text-sm font-normal leading-5 text-[#737373] dark:text-neutral-500"
                        >
                          {{ groupCounts.get(g.key) ?? 0 }}
                        </span>
                      </label>
                    </li>
                  </ul>
                </div>
              </div>
            </aside>

            <!-- ============ 网格区 ============ -->
            <div class="min-w-0 flex-1 lg:pl-8">
              <!-- 头部：计数 + 排序 -->
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                  <span
                    class="text-[20px] font-semibold leading-7 text-[#0A0A0A] dark:text-neutral-50"
                  >
                    {{ t('public.models.countTitle', { n: filtered.length }) }}
                  </span>
                </div>

                <div class="flex items-center gap-3">
                  <!-- 网格 / 列表 视图切换 -->
                  <div
                    role="group"
                    :aria-label="t('public.models.view')"
                    class="inline-flex shrink-0 gap-1 rounded-[8px] bg-[#F5F5F5] p-1 dark:bg-neutral-900"
                  >
                    <button
                      type="button"
                      :aria-pressed="view === 'grid'"
                      :title="t('public.models.viewGrid')"
                      class="flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-sm font-medium leading-5 transition-colors"
                      :class="
                        view === 'grid'
                          ? 'bg-white text-[#0A0A0A] shadow-[0px_1px_4px_rgba(0,0,0,0.12)] dark:bg-neutral-800 dark:text-neutral-50'
                          : 'text-[#525252] hover:text-[#0A0A0A] dark:text-neutral-400 dark:hover:text-neutral-100'
                      "
                      @click="setView('grid')"
                    >
                      <LayoutGrid class="size-4" />
                      <span class="hidden sm:inline">{{ t('public.models.viewGrid') }}</span>
                    </button>
                    <button
                      type="button"
                      :aria-pressed="view === 'list'"
                      :title="t('public.models.viewList')"
                      class="flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-sm font-medium leading-5 transition-colors"
                      :class="
                        view === 'list'
                          ? 'bg-white text-[#0A0A0A] shadow-[0px_1px_4px_rgba(0,0,0,0.12)] dark:bg-neutral-800 dark:text-neutral-50'
                          : 'text-[#525252] hover:text-[#0A0A0A] dark:text-neutral-400 dark:hover:text-neutral-100'
                      "
                      @click="setView('list')"
                    >
                      <List class="size-4" />
                      <span class="hidden sm:inline">{{ t('public.models.viewList') }}</span>
                    </button>
                  </div>

                  <div class="relative">
                    <select
                      v-model="sortKey"
                      :aria-label="t('public.models.sort')"
                      class="h-9 min-w-[146px] appearance-none rounded-[8px] border border-[#D4D4D4] bg-white pl-3 pr-9 text-[14px] font-medium leading-5 text-[#0A0A0A] shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                    >
                      <option value="name">{{ t('public.models.sortName') }}</option>
                      <option value="priceAsc">{{ t('public.models.sortPriceAsc') }}</option>
                      <option value="priceDesc">{{ t('public.models.sortPriceDesc') }}</option>
                    </select>
                    <ChevronDown
                      class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#0A0A0A] dark:text-neutral-100"
                    />
                  </div>
                </div>
              </div>

              <!-- 骨架 / 错误 / 空态 -->
              <div
                v-if="pricingQ.isLoading.value"
                class="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3"
              >
                <div
                  v-for="i in 6"
                  :key="i"
                  class="h-[313px] animate-pulse rounded-[10px] border border-[#E5E5E5] bg-[#FAFAFA] dark:border-neutral-800 dark:bg-neutral-900"
                />
              </div>

              <div
                v-else-if="pricingQ.error.value"
                class="mt-6 rounded-[10px] border border-[#E5E5E5] px-4 py-14 text-center dark:border-neutral-800"
              >
                <p class="text-sm text-danger-fg">{{ pricingQ.error.value.message }}</p>
                <button
                  type="button"
                  class="motion-press mt-4 rounded-[8px] border border-[#D4D4D4] px-4 py-2 text-sm text-[#525252] hover:bg-[#F5F5F5] dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-900"
                  @click="pricingQ.refetch()"
                >
                  {{ t('common.retry') }}
                </button>
              </div>

              <div
                v-else-if="!filtered.length"
                class="mt-6 rounded-[10px] border border-[#E5E5E5] px-4 py-16 text-center dark:border-neutral-800"
              >
                <Boxes class="mx-auto size-7 text-[#A3A3A3]" />
                <p class="mt-3 text-sm font-medium text-[#0A0A0A] dark:text-neutral-100">
                  {{ t('models.emptyTitle') }}
                </p>
                <p class="mt-1 text-sm text-[#737373] dark:text-neutral-400">
                  {{ t('models.emptyDesc') }}
                </p>
              </div>

              <!-- 模型卡（网格 / 列表） -->
              <div
                v-else
                class="mt-6 grid grid-cols-1 gap-6"
                :class="view === 'list' ? 'grid-cols-1' : 'lg:grid-cols-2 xl:grid-cols-3'"
              >
                <ModelCard
                  v-for="m in filtered"
                  :key="m.model_name"
                  :model="m"
                  :vendor-name="vendorName(m.vendor_id)"
                  :icon="iconOf(m)"
                  :group-ratio="groupRatio"
                  :copied="copied === m.model_name"
                  :layout="view"
                  :metric="perfMap[m.model_name]"
                  @copy="copyName"
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
    </div>
</template>

<style scoped>
/* 搜索框在暗色 hero 上仍要可读：placeholder 提亮一档 */
</style>
