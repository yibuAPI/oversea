<script setup lang="ts">
/**
 * 公开价格页 /pricing —— 版式对照 infron 文档的「Pricing and Fee Structure」：
 *
 *   大标题 + 副题
 *   Pricing Model  三条加粗要点（按量 / 按模型 / 无订阅）
 *   Pricing Plans  搜索框 + 全量价目表（模型 × 输入/输出价）
 *   Important Notes 结算说明
 *
 * 价格来自公开 GET /api/pricing，页面展示即实际结算价。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import { Search, ReceiptText, ArrowRight } from 'lucide-vue-next'
import { getPricing, inputPrice, outputPrice } from '@/api/models'
import type { PricingModel } from '@/api/types'

const { t } = useI18n()

const pricingQ = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

const search = ref('')
const vendorId = ref<number | 'all'>('all')

const models = computed(() => pricingQ.data.value?.data ?? [])
const vendors = computed(() => pricingQ.data.value?.vendors ?? [])

const groupRatio = computed(() => {
  const g = pricingQ.data.value?.group_ratio ?? {}
  if (typeof g.default === 'number') return g.default
  const first = Object.values(g).find((v) => typeof v === 'number')
  return typeof first === 'number' ? first : 1
})

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
        vendorName(m.vendor_id).toLowerCase().includes(q)
      )
    })
    .sort(
      (a, b) =>
        (a.vendor_id ?? 999) - (b.vendor_id ?? 999) ||
        a.model_name.localeCompare(b.model_name),
    )
})

const fmt = (v: number) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`

function rowPrice(m: PricingModel) {
  if (m.quota_type === 1) {
    return {
      perCall: `$${m.model_price.toFixed(m.model_price < 0.01 ? 5 : 3)}`,
      input: null,
      output: null,
    }
  }
  return {
    perCall: null,
    input: fmt(inputPrice(m.model_ratio, groupRatio.value)),
    output: fmt(outputPrice(m.model_ratio, m.completion_ratio, groupRatio.value)),
  }
}
</script>

<template>
  <div class="mx-auto max-w-[1100px] px-6 pb-24 pt-[140px] lg:pt-[168px]">
    <!-- 文档式大标题 -->
    <div class="flex items-center gap-3">
      <span
        class="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-bg-elevated"
      >
        <ReceiptText class="size-5 text-fg-muted" />
      </span>
      <h1 class="text-[30px] font-bold tracking-tight lg:text-[38px]">
        {{ t('public.pricing.title') }}
      </h1>
    </div>
    <p class="mt-3 text-[16px] leading-relaxed text-fg-muted">
      {{ t('public.pricing.subtitle') }}
    </p>

    <!-- Pricing Model：加粗要点 -->
    <section class="mt-12">
      <h2 class="text-[24px] font-bold tracking-tight">
        {{ t('public.pricing.modelTitle') }}
      </h2>
      <ul class="mt-5 space-y-3 text-[15px] leading-relaxed">
        <li v-for="i in 3" :key="i" class="flex gap-3">
          <span class="mt-[11px] size-1.5 shrink-0 rounded-full bg-fg" aria-hidden="true" />
          <span>
            <strong class="font-bold">{{ t(`public.pricing.point${i}.strong`) }}</strong>
            <span class="text-fg-secondary"> — {{ t(`public.pricing.point${i}.rest`) }}</span>
          </span>
        </li>
      </ul>
    </section>

    <!-- Pricing Plans：搜索 + 价目表 -->
    <section class="mt-14">
      <h2 class="text-[24px] font-bold tracking-tight">
        {{ t('public.pricing.tableTitle') }}
      </h2>

      <div class="mt-5 flex flex-wrap items-center gap-2">
        <div class="relative min-w-[260px] flex-1">
          <Search
            class="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <input
            v-model="search"
            type="search"
            :placeholder="t('models.searchPlaceholder')"
            class="h-11 w-full rounded-xl border border-border bg-bg pl-10 pr-4 text-[14px] outline-none transition-colors focus:border-accent"
          />
        </div>
        <select
          v-if="vendors.length"
          v-model="vendorId"
          :aria-label="t('models.allVendors')"
          class="h-11 rounded-xl border border-border bg-bg px-3 text-[13.5px] outline-none focus:border-accent"
        >
          <option value="all">{{ t('models.allVendors') }}</option>
          <option v-for="v in vendors" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
      </div>

      <div v-if="pricingQ.isLoading.value" class="mt-5 space-y-2">
        <div
          v-for="i in 8"
          :key="i"
          class="h-12 animate-pulse rounded-lg border border-border bg-bg-elevated"
        />
      </div>

      <div
        v-else-if="pricingQ.error.value"
        class="mt-5 rounded-2xl border border-border bg-bg-elevated px-4 py-14 text-center"
      >
        <p class="text-[14px] text-danger-fg">{{ pricingQ.error.value.message }}</p>
        <button
          type="button"
          class="mt-4 rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
          @click="pricingQ.refetch()"
        >
          {{ t('common.retry') }}
        </button>
      </div>

      <div
        v-else
        class="mt-5 overflow-hidden rounded-2xl border border-border bg-bg-elevated"
      >
        <div class="overflow-x-auto">
          <table class="w-full text-[13.5px]">
            <thead>
              <tr class="border-b border-border bg-bg-subtle text-left">
                <th class="px-4 py-3 font-semibold">
                  {{ t('public.pricing.colModel') }}
                </th>
                <th class="px-4 py-3 font-semibold">
                  {{ t('public.pricing.colVendor') }}
                </th>
                <th class="px-4 py-3 text-right font-semibold">
                  {{ t('models.input') }}
                </th>
                <th class="px-4 py-3 text-right font-semibold">
                  {{ t('models.output') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in filtered"
                :key="m.model_name"
                class="border-b border-border last:border-0 hover:bg-bg-muted/50"
              >
                <td class="px-4 py-3 font-mono text-[12.5px]">{{ m.model_name }}</td>
                <td class="px-4 py-3 text-fg-muted">{{ vendorName(m.vendor_id) }}</td>
                <template v-if="rowPrice(m).perCall">
                  <td colspan="2" class="px-4 py-3 text-right tabular">
                    {{ rowPrice(m).perCall }}
                    <span class="text-fg-subtle">{{ t('public.pricing.perCallUnit') }}</span>
                  </td>
                </template>
                <template v-else>
                  <td class="px-4 py-3 text-right tabular">{{ rowPrice(m).input }}</td>
                  <td class="px-4 py-3 text-right tabular">{{ rowPrice(m).output }}</td>
                </template>
              </tr>
              <tr v-if="!filtered.length">
                <td colspan="4" class="px-4 py-12 text-center text-fg-subtle">
                  {{ t('models.emptyTitle') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Important Notes -->
    <section class="mt-14">
      <h2 class="text-[24px] font-bold tracking-tight">
        {{ t('public.pricing.notesTitle') }}
      </h2>
      <ul class="mt-5 space-y-3 text-[14.5px] leading-relaxed text-fg-secondary">
        <li v-for="i in 3" :key="i" class="flex gap-3">
          <span
            class="mt-[10px] size-1.5 shrink-0 rounded-full bg-fg-subtle"
            aria-hidden="true"
          />
          {{ t(`public.pricing.note${i}`) }}
        </li>
      </ul>
    </section>

    <!-- 收尾 CTA -->
    <div class="mt-16 rounded-2xl border border-border bg-bg-subtle p-8 text-center">
      <h2 class="text-[22px] font-bold tracking-tight">
        {{ t('public.pricing.ctaTitle') }}
      </h2>
      <p class="mt-2 text-[14px] text-fg-muted">{{ t('public.pricing.ctaDesc') }}</p>
      <RouterLink
        to="/console"
        class="group mt-6 inline-flex h-10 items-center gap-2.5 rounded-[20px] bg-btn-primary-bg py-2 pl-[18px] pr-2 text-[14px] text-btn-primary-fg transition-opacity hover:opacity-88"
      >
        {{ t('home.hero.primaryCta') }}
        <span
          class="grid size-6 shrink-0 place-items-center rounded-full bg-btn-primary-fg/15 transition-transform group-hover:translate-x-0.5"
        >
          <ArrowRight class="size-3.5" />
        </span>
      </RouterLink>
    </div>
  </div>
</template>
