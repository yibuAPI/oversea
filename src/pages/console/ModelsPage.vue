<script setup lang="ts">
/**
 * 模型库。对齐 infron 的 Models explore 页：
 * 顶部搜索 + 厂商筛选，下面是模型卡片网格，每张卡显示输入/输出价。
 *
 * 数据全部来自 GET /api/pricing（扁平响应，见 api/models.ts）。
 * 价格换算：
 *   按量模型 quota_type=0 -> 倍率 × 分组倍率 × $2/M tokens
 *   按次模型 quota_type=1 -> model_price 就是每次调用的美元数
 * 分组倍率跟着用户当前选中的分组变 —— 同一个模型在不同分组价格不同，
 * 这点不能糊，否则用户按页面报价做预算会算错。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { Search, Boxes, Copy, Check } from 'lucide-vue-next'
import { getPricing, inputPrice, outputPrice } from '@/api/models'
import type { PricingModel } from '@/api/types'
import PageHeader from '@/components/ui/PageHeader.vue'

const { t } = useI18n()

const pricingQ = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

const search = ref('')
const vendorId = ref<number | 'all'>('all')
/** 当前用于报价的分组。默认取 usable_group 的第一个 */
const group = ref<string>('')

const models = computed(() => pricingQ.data.value?.data ?? [])
const vendors = computed(() => pricingQ.data.value?.vendors ?? [])
const groupRatios = computed(() => pricingQ.data.value?.group_ratio ?? {})

/** 用户可用的分组（后端已按用户权限过滤） */
const usableGroups = computed(() => {
  const g = pricingQ.data.value?.usable_group ?? {}
  return Object.entries(g).map(([key, label]) => ({ key, label }))
})

const activeGroup = computed(
  () => group.value || usableGroups.value[0]?.key || 'default',
)

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

const vendorName = (id?: number) =>
  vendors.value.find((v) => v.id === id)?.name ?? t('models.vendorOther')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return models.value
    .filter((m) => {
      if (vendorId.value !== 'all' && (m.vendor_id ?? 0) !== vendorId.value) return false
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

/** 每个厂商有多少模型，给筛选条上的计数用 */
const vendorCounts = computed(() => {
  const m = new Map<number, number>()
  for (const x of models.value) {
    const id = x.vendor_id ?? 0
    m.set(id, (m.get(id) ?? 0) + 1)
  }
  return m
})

/** 价格展示。按次计费的单位是「每次」，不能和 /M tokens 混排 */
function priceLabel(m: PricingModel) {
  if (m.quota_type === 1) {
    return {
      kind: 'call' as const,
      input: `$${m.model_price.toFixed(m.model_price < 0.01 ? 5 : 3)}`,
      output: null,
    }
  }
  const inp = inputPrice(m.model_ratio, activeRatio.value)
  const out = outputPrice(m.model_ratio, m.completion_ratio, activeRatio.value)
  const fmt = (v: number) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`
  return { kind: 'token' as const, input: fmt(inp), output: fmt(out) }
}

/** tags 后端是逗号分隔字符串 */
const tagsOf = (m: PricingModel) =>
  (m.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)

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
      <div class="relative min-w-[220px] flex-1">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
        />
        <input
          v-model="search"
          type="search"
          :placeholder="t('models.searchPlaceholder')"
          class="h-9 w-full rounded-lg border border-border bg-bg pl-8 pr-3 text-[13px] outline-none focus:border-accent"
        />
      </div>

      <select
        v-if="usableGroups.length > 1"
        v-model="group"
        :aria-label="t('models.group')"
        class="h-9 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-accent"
      >
        <option v-for="g in usableGroups" :key="g.key" :value="g.key">
          {{ g.label }}
        </option>
      </select>
    </div>

    <!-- 分组倍率提示：报价随分组变，必须说清当前算的是哪个 -->
    <p v-if="!pricingQ.isLoading.value" class="mb-4 text-[12px] text-fg-subtle">
      {{
        ratioUnknown
          ? t('models.ratioAuto', { group: activeGroup })
          : t('models.ratioHint', { group: activeGroup, ratio: activeRatio })
      }}
    </p>

    <!-- 厂商筛选 -->
    <div v-if="vendors.length" class="mb-5 flex flex-wrap gap-1.5">
      <button
        type="button"
        class="rounded-full border px-2.5 py-1 text-[12px] transition-colors"
        :class="
          vendorId === 'all'
            ? 'border-accent bg-accent-bg text-accent'
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
            ? 'border-accent bg-accent-bg text-accent'
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
        v-for="m in filtered"
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
            <template v-else>
              <div>
                <p class="text-[10.5px] uppercase tracking-wide text-fg-subtle">
                  {{ t('models.perCall') }}
                </p>
                <p class="text-[13px] font-medium tabular">{{ priceLabel(m).input }}</p>
              </div>
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

    <p v-if="filtered.length" class="mt-4 text-[12px] text-fg-subtle">
      {{ t('models.countHint', { shown: filtered.length, total: models.length }) }}
    </p>
  </div>
</template>
