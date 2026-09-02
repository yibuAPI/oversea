<script setup lang="ts">
/**
 * 模型库。对齐 infron 的 Models explore 页：
 * 顶部搜索 + 厂商筛选，下面是模型卡片网格，每张卡显示输入/输出价。
 *
 * 数据全部来自 GET /api/pricing（扁平响应，见 api/models.ts）。
 * 价格换算：
 *   按量模型 quota_type=0 -> 倍率 × 分组倍率 × $2/M tokens
 *   按次模型 quota_type=1 -> model_price 就是每次调用的美元数
 *   动态计费 billing_mode=tiered_expr（或 quota_type=2）-> 无固定单价，统一展示「动态计费」
 * 分组倍率跟着用户当前选中的分组变 —— 同一个模型在不同分组价格不同，
 * 这点不能糊，否则用户按页面报价做预算会算错。
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { Search, Boxes, Copy, Check, ChevronDown } from 'lucide-vue-next'
import { getPricing, inputPrice, outputPrice } from '@/api/models'
import type { PricingModel } from '@/api/types'
import PageHeader from '@/components/ui/PageHeader.vue'
import Pagination from '@/components/ui/Pagination.vue'

const { t } = useI18n()

const pricingQ = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

const search = ref('')
const vendorId = ref<number | 'all'>('all')
/**
 * 分组筛选。空 Set = 不按分组筛，展示全部可用模型；
 * 选中任意分组则只看这些分组开放的模型（enable_groups）。
 * 报价用的分组见 activeGroup —— 两者独立：默认「全部分组」时报价仍落到用户基准分组。
 */
const groupSel = ref<Set<string>>(new Set())

/** 分页：默认每页 20 条，可选 10/20/50/100。列表是前端筛的，切片也放前端 */
const page = ref(1)
const pageSize = ref(20)

const models = computed(() => pricingQ.data.value?.data ?? [])
const vendors = computed(() => pricingQ.data.value?.vendors ?? [])
const groupRatios = computed(() => pricingQ.data.value?.group_ratio ?? {})

/**
 * 用户可用的分组（后端已按用户权限过滤）。
 * 下拉选项与「新增密钥」保持一致：分组名（key）+ 倍率，即 `default（×2）`。
 * usable_group 的 value 是可读描述，仅在无倍率时兜底显示。
 */
const usableGroups = computed(() => {
  const g = pricingQ.data.value?.usable_group ?? {}
  const ratios = pricingQ.data.value?.group_ratio ?? {}
  return Object.entries(g).map(([key, label]) => {
    const ratio = ratios[key]
    return { key, label, ratio: typeof ratio === 'number' ? ratio : null }
  })
})

/**
 * 当前用于报价的分组。选中了具体分组就跟着它走；
 * 未选分组时回落到 default（用户基准分组），没有才取第一个。
 */
const activeGroup = computed({
  get: () => {
    if (groupSel.value.size) return [...groupSel.value][0]
    if (usableGroups.value.some((g) => g.key === 'default')) return 'default'
    return usableGroups.value[0]?.key || 'default'
  },
  set: (v: string) => {
    groupSel.value = new Set([v])
  },
})

/**
 * 分组倍率。auto 分组在 group_ratio 里可能没有条目
 * （它是运行时按实际渠道选的），此时按 1 处理并在 UI 上标注。
 */
const activeRatio = computed(() => {
  const r = groupRatios.value[activeGroup.value]
  return typeof r === 'number' ? r : 1
})
const ratioUnknown = computed(
  () => typeof groupRatios.value[activeGroup.value] !== 'number',
)

/** 提示文案里显示分组的可读名称，回落到 key */
const activeGroupLabel = computed(
  () =>
    usableGroups.value.find((g) => g.key === activeGroup.value)?.label ||
    activeGroup.value,
)

const vendorName = (id?: number) =>
  vendors.value.find((v) => v.id === id)?.name ?? t('models.vendorOther')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return models.value
    .filter((m) => {
      if (vendorId.value !== 'all' && (m.vendor_id ?? 0) !== vendorId.value) return false
      if (groupSel.value.size) {
        const gs = m.enable_groups ?? []
        if (!gs.some((g) => groupSel.value.has(g))) return false
      }
      if (!q) return true
      return (
        m.model_name.toLowerCase().includes(q) ||
        (m.description ?? '').toLowerCase().includes(q) ||
        vendorName(m.vendor_id).toLowerCase().includes(q)
      )
    })
    // 同厂商内按名字排，整体按厂商聚拢 —— 网格里乱序很难扫读
    .sort(
      (a, b) =>
        (a.vendor_id ?? 999) - (b.vendor_id ?? 999) ||
        a.model_name.localeCompare(b.model_name),
    )
})

/** 当前页要展示的模型 —— 对已筛选的列表做切片，避免一次性渲染上百张卡 */
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

// 筛选条件或每页条数变了就回到第 1 页
watch([search, vendorId, groupSel, pageSize], () => {
  page.value = 1
})

// 结果变少时把页码夹回合法范围，别停在空页上
watch(
  () => filtered.value.length,
  (len) => {
    const maxPage = Math.max(1, Math.ceil(len / pageSize.value))
    if (page.value > maxPage) page.value = maxPage
  },
)

/** 每个厂商有多少模型，给筛选条上的计数用 */
const vendorCounts = computed(() => {
  const m = new Map<number, number>()
  for (const x of models.value) {
    const id = x.vendor_id ?? 0
    m.set(id, (m.get(id) ?? 0) + 1)
  }
  return m
})

/** 每个分组开放了多少模型，给「N 可用模型」标签用 */
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

/** 分组下拉的展开/收起，以及点击外部关闭 */
const groupOpen = ref(false)
function onDocClick(e: MouseEvent) {
  const el = groupWrap.value
  if (!el || !el.contains(e.target as Node)) groupOpen.value = false
}
const groupWrap = ref<HTMLElement | null>(null)
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

/** 价格展示。按次计费的单位是「每次」，不能和 /M tokens 混排。
 *  动态计费（billing_mode=tiered_expr）与 quota_type=2 一样无固定单价，均按阶梯桶展示。 */
function priceLabel(m: PricingModel) {
  if (m.quota_type === 1) {
    return {
      kind: 'call' as const,
      input: `$${m.model_price.toFixed(m.model_price < 0.01 ? 5 : 3)}`,
      output: null,
    }
  }
  if (m.billing_mode === 'tiered_expr' || m.quota_type === 2) {
    return { kind: 'tiered' as const, input: null, output: null }
  }
  const inp = inputPrice(m.model_ratio, activeRatio.value)
  const out = outputPrice(m.model_ratio, m.completion_ratio, activeRatio.value)
  const fmt = (v: number) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`
  return { kind: 'token' as const, input: fmt(inp), output: fmt(out) }
}

/** tags 后端是逗号分隔字符串 */
const tagsOf = (m: PricingModel) =>
  (m.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** 倍率标签：1 → "1"，0.25 → "0.25"（去掉浮点尾噪） */
const ratioLabel = (n: number) => String(Number.parseFloat(n.toFixed(2)))

const copied = ref<string | null>(null)
async function copyName(name: string) {
  try {
    await navigator.clipboard.writeText(name)
    copied.value = name
    setTimeout(() => (copied.value = null), 1500)
  } catch {
    /* 剪贴板不可用时静默 —— 名字就在眼前，手动选也能复制 */
  }
}
</script>

<template>
  <div>
    <PageHeader :title="t('models.title')" :description="t('models.subtitle')" />

    <!-- 工具条 -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="relative flex-1">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
        />
        <input
          v-model="search"
          type="search"
          :placeholder="t('models.searchPlaceholder')"
          class="h-9 w-full rounded-lg border border-border bg-bg pl-8 pr-3 text-[13px] outline-none focus:border-border-selected"
        />
      </div>

      <!-- 分组多选下拉 -->
      <div ref="groupWrap" class="relative flex-1">
        <button
          type="button"
          :aria-expanded="groupOpen"
          :aria-label="t('models.group')"
          class="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 text-[13px] outline-none focus:border-border-selected"
          @click="groupOpen = !groupOpen"
        >
          <span v-if="groupSel.size" class="truncate">{{ [...groupSel].join('、') }}</span>
          <span v-else class="truncate text-fg-muted">{{ t('models.groupPlaceholder') }}</span>
          <ChevronDown
            class="ml-auto size-3.5 shrink-0 text-fg-subtle transition-transform"
            :class="groupOpen ? 'rotate-180' : ''"
          />
        </button>

        <div
          v-if="groupOpen"
          class="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
        >
          <button
            type="button"
            class="motion-press flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-fg-muted hover:bg-bg-muted hover:text-fg"
            @click="groupSel = new Set()"
          >
            <Check v-if="!groupSel.size" class="size-3.5 shrink-0 text-accent" />
            <span v-else class="size-3.5 shrink-0" />
            {{ t('models.allGroups') }}
          </button>
          <div class="mx-2 my-1 border-t border-border" />
          <button
            v-for="g in usableGroups"
            :key="g.key"
            type="button"
            class="motion-press flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-muted"
            @click="toggleGroup(g.key)"
          >
            <Check
              v-if="groupSel.has(g.key)"
              class="mt-0.5 size-3.5 shrink-0 text-accent"
            />
            <span v-else class="mt-0.5 size-3.5 shrink-0" />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-[12.5px] font-semibold text-fg">{{ g.key }}</span>
              <span v-if="g.label && g.label !== g.key" class="text-[11.5px] text-fg-muted">
                {{ g.label }}
              </span>
            </span>
            <span class="flex shrink-0 items-center gap-1.5 pt-0.5">
              <span
                class="rounded bg-success-bg px-2 py-1 text-[10.5px] leading-none text-success-fg"
              >
                {{ t('models.groupAvailable', { n: groupCounts.get(g.key) ?? 0 }) }}
              </span>
              <span
                class="rounded bg-info-bg px-2 py-1 text-[10.5px] leading-none text-info-fg"
              >
                {{ t('models.groupRatio', { n: ratioLabel(g.ratio ?? 1) }) }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- 分组倍率提示：报价随分组变，必须说清当前算的是哪个 -->
    <p v-if="!pricingQ.isLoading.value" class="mb-4 text-[12px] text-fg-subtle">
      {{
        ratioUnknown
          ? t('models.ratioAuto', { group: activeGroupLabel })
          : t('models.ratioHint', { group: activeGroupLabel, ratio: activeRatio })
      }}
    </p>

    <!-- 厂商筛选 -->
    <div v-if="vendors.length" class="mb-5 flex flex-wrap gap-1.5">
      <button
        type="button"
        class="rounded-full border px-2.5 py-1 text-[12px] transition-colors"
        :class="
          vendorId === 'all'
            ? 'border-border-selected bg-accent-bg text-accent'
            : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg'
        "
        @click="vendorId = 'all'"
      >
        {{ t('models.allVendors') }}
        <span class="ml-1 tabular opacity-60">{{ models.length }}</span>
      </button>
      <button
        v-for="v in vendors"
        :key="v.id"
        type="button"
        class="rounded-full border px-2.5 py-1 text-[12px] transition-colors"
        :class="
          vendorId === v.id
            ? 'border-border-selected bg-accent-bg text-accent'
            : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg'
        "
        @click="vendorId = v.id"
      >
        {{ v.name }}
        <span class="ml-1 tabular opacity-60">{{ vendorCounts.get(v.id) ?? 0 }}</span>
      </button>
    </div>

    <!-- 加载骨架 -->
    <div v-if="pricingQ.isLoading.value" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="i in 9"
        :key="i"
        class="h-[132px] animate-pulse rounded-xl border border-border bg-bg-elevated"
      />
    </div>

    <div
      v-else-if="pricingQ.error.value"
      class="rounded-xl border border-border bg-bg-elevated px-4 py-12 text-center"
    >
      <p class="text-[13px] text-danger-fg">
        {{ pricingQ.error.value.message }}
      </p>
      <button
        type="button"
        class="mt-3 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
        @click="pricingQ.refetch()"
      >
        {{ t('common.retry') }}
      </button>
    </div>

    <div
      v-else-if="!filtered.length"
      class="rounded-xl border border-border bg-bg-elevated px-4 py-16 text-center"
    >
      <Boxes class="mx-auto size-7 text-fg-subtle" />
      <p class="mt-3 text-[13.5px] font-medium">{{ t('models.emptyTitle') }}</p>
      <p class="mt-1 text-[12.5px] text-fg-subtle">{{ t('models.emptyDesc') }}</p>
    </div>

    <!-- 模型卡网格 -->
    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <article
        v-for="m in paged"
        :key="m.model_name"
        class="group flex flex-col rounded-xl border border-border bg-bg-elevated p-4 transition-colors hover:border-border-strong"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="truncate text-[13.5px] font-semibold" :title="m.model_name">
              {{ m.model_name }}
            </h3>
            <p class="mt-0.5 text-[11.5px] text-fg-subtle">
              {{ vendorName(m.vendor_id) }}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-md p-1 text-fg-subtle opacity-0 transition-all hover:bg-bg-muted hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            :aria-label="t('models.copyName')"
            @click="copyName(m.model_name)"
          >
            <Check v-if="copied === m.model_name" class="size-3.5 text-success-fg" />
            <Copy v-else class="size-3.5" />
          </button>
        </div>

        <p
          v-if="m.description"
          class="mt-2 line-clamp-2 text-[12px] leading-relaxed text-fg-muted"
        >
          {{ m.description }}
        </p>

        <div v-if="tagsOf(m).length" class="mt-2 flex flex-wrap gap-1">
          <span
            v-for="tag in tagsOf(m).slice(0, 3)"
            :key="tag"
            class="rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-[10.5px] text-fg-muted"
          >
            {{ tag }}
          </span>
        </div>

        <!-- 价格钉在卡片底部，卡高不齐会显得很散 -->
        <div class="mt-auto pt-3">
          <div class="flex items-end justify-between gap-2 border-t border-border pt-2.5">
            <template v-if="priceLabel(m).kind === 'token'">
              <div>
                <p class="text-[10.5px] uppercase tracking-wide text-fg-subtle">
                  {{ t('models.input') }}
                </p>
                <p class="text-[13px] font-medium tabular">{{ priceLabel(m).input }}</p>
              </div>
              <div class="text-right">
                <p class="text-[10.5px] uppercase tracking-wide text-fg-subtle">
                  {{ t('models.output') }}
                </p>
                <p class="text-[13px] font-medium tabular">{{ priceLabel(m).output }}</p>
              </div>
            </template>
            <template v-else-if="priceLabel(m).kind === 'call'">
              <div>
                <p class="text-[10.5px] uppercase tracking-wide text-fg-subtle">
                  {{ t('models.perCall') }}
                </p>
                <p class="text-[13px] font-medium tabular">{{ priceLabel(m).input }}</p>
              </div>
            </template>
            <template v-else>
              <p class="text-[11px] leading-relaxed text-fg-subtle">
                {{ t('models.priceTiered') }}
              </p>
            </template>
          </div>
          <p
            v-if="priceLabel(m).kind === 'token'"
            class="mt-1 text-[10.5px] text-fg-subtle"
          >
            {{ t('models.perMillion') }}
          </p>
        </div>
      </article>
    </div>

    <Pagination
      v-if="!pricingQ.isLoading.value && !pricingQ.error.value"
      :page="page"
      :page-size="pageSize"
      :total="filtered.length"
      :page-size-options="[10, 20, 50, 100]"
      @update:page="page = $event"
      @update:page-size="((pageSize = $event), (page = 1))"
    />

    <p v-if="filtered.length" class="mt-2 text-[12px] text-fg-subtle">
      {{ t('models.countHint', { shown: paged.length, total: models.length }) }}
    </p>
  </div>
</template>
