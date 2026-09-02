<script setup lang="ts">
/**
 * 公开价格页 /pricing —— 逐区块对照 infron.ai/docs 的「Pricing and Fee Structure」：
 *
 *   图标 + 大标题 + 副题
 *   Pricing Model    三条加粗要点（按量 / 按模型 / 无订阅）
 *   Pricing Plans    搜索框 + Pay-as-you-go × Enterprise 双列对比表
 *                    （平台费 / 模型价格 / 模型目录 / 功能 ✅ / SLA / 支付 / 退款 / 余额）
 *   Important Notes  服务费说明 + $50 充值费用明细示例表
 *   On this page     右侧锚点栏（xl 起显示），滚动跟随高亮
 *
 * 全部内容为静态方案对比，不再拉 /api/pricing —— 逐模型价目表在 /models。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { RouterLink } from 'vue-router'
import { Search, ReceiptText, ArrowRight, AlignLeft } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'

const { t } = useI18n()
const site = useSiteStore()
const { systemName } = storeToRefs(site)

const search = ref('')

/**
 * 对比表行模型。cell 三种形态：
 *  - check: ✅
 *  - text:  纯文字（可带 code 徽标前缀）
 *  - rich:  由模板具名插槽渲染（模型价格 / 模型目录两行的复合内容）
 */
type Cell =
  | { kind: 'check' }
  | { kind: 'blank' }
  | { kind: 'text'; text: string; code?: string; suffix?: string }
  | { kind: 'rich'; slot: string }

interface PlanRow {
  key: string
  label: string
  learnMore?: string
  payg: Cell
  ent: Cell
}

const rk = (k: string) => t(`public.pricing.row.${k}`)

const rows = computed<PlanRow[]>(() => [
  {
    key: 'fees',
    label: rk('platformFees'),
    payg: { kind: 'text', text: '', code: '5% + $0.35', suffix: t('public.pricing.perTransaction') },
    ent: { kind: 'text', text: '', code: '3%', suffix: t('public.pricing.perTransaction') },
  },
  {
    key: 'prices',
    label: rk('modelPrices'),
    payg: { kind: 'rich', slot: 'prices-payg' },
    ent: { kind: 'rich', slot: 'prices-ent' },
  },
  {
    key: 'models',
    label: rk('models'),
    learnMore: '/models',
    payg: { kind: 'rich', slot: 'models' },
    ent: { kind: 'rich', slot: 'models' },
  },
  { key: 'chat', label: rk('chat'), payg: { kind: 'check' }, ent: { kind: 'check' } },
  { key: 'logs', label: rk('logs'), payg: { kind: 'check' }, ent: { kind: 'check' } },
  {
    key: 'routing',
    label: rk('routing'),
    learnMore: '/docs',
    payg: { kind: 'check' },
    ent: { kind: 'check' },
  },
  {
    key: 'fallbacks',
    label: rk('fallbacks'),
    learnMore: '/docs',
    payg: { kind: 'check' },
    ent: { kind: 'check' },
  },
  { key: 'budgets', label: rk('budgets'), payg: { kind: 'check' }, ent: { kind: 'check' } },
  {
    key: 'caching',
    label: rk('caching'),
    learnMore: '/docs',
    payg: { kind: 'check' },
    ent: { kind: 'check' },
  },
  {
    key: 'sla',
    label: rk('sla'),
    payg: { kind: 'text', text: rk('slaPayg') },
    ent: { kind: 'text', text: rk('slaEnt') },
  },
  {
    key: 'payment',
    label: rk('payment'),
    payg: { kind: 'text', text: rk('paymentBoth') },
    ent: { kind: 'text', text: rk('paymentBoth') },
  },
  {
    key: 'invoicing',
    label: rk('invoicing'),
    payg: { kind: 'blank' },
    ent: { kind: 'check' },
  },
  {
    key: 'byok',
    label: rk('byok'),
    learnMore: '/docs',
    payg: { kind: 'text', text: '', code: '0%', suffix: rk('byokFee') },
    ent: { kind: 'text', text: '', code: '0%', suffix: rk('byokFee') },
  },
  {
    key: 'rate',
    label: rk('rate'),
    payg: { kind: 'text', text: rk('ratePayg') },
    ent: { kind: 'text', text: rk('rateEnt') },
  },
  {
    key: 'support',
    label: rk('support'),
    payg: { kind: 'text', text: rk('supportPayg') },
    ent: { kind: 'text', text: rk('supportEnt') },
  },
  {
    key: 'refund',
    label: rk('refund'),
    payg: { kind: 'text', text: rk('refundPayg') },
    ent: { kind: 'text', text: rk('refundEnt') },
  },
  {
    key: 'credits',
    label: rk('credits'),
    payg: { kind: 'text', text: rk('creditsBoth') },
    ent: { kind: 'text', text: rk('creditsBoth') },
  },
])

/** 搜索：对行标签 + 两栏文字做包含匹配（模型价格/目录等富文本行按插槽文案拼串） */
function rowHaystack(r: PlanRow) {
  const cellText = (c: Cell) =>
    c.kind === 'text' ? `${c.code ?? ''} ${c.text} ${c.suffix ?? ''}` : ''
  const rich =
    r.key === 'prices'
      ? `${rk('markup')} ${t('public.pricing.row.passthrough', { name: systemName.value })} ${rk('entDiscount')}`
      : r.key === 'models'
        ? `${rk('modelsCount')} ${[1, 2, 3, 4, 5, 6].map((i) => rk(`cat${i}`)).join(' ')}`
        : ''
  return `${r.label} ${cellText(r.payg)} ${cellText(r.ent)} ${rich}`.toLowerCase()
}

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((r) => rowHaystack(r).includes(q))
})

const modelCats = [1, 2, 3, 4, 5, 6] as const

// ───────── On this page：h2 锚点滚动跟随 ─────────
const sections = computed(() => [
  { id: 'pricing-model', text: t('public.pricing.modelTitle') },
  { id: 'pricing-plans', text: t('public.pricing.plansTitle') },
  { id: 'important-notes', text: t('public.pricing.notesTitle') },
])
const activeAnchor = ref('')
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) activeAnchor.value = visible.target.id
    },
    { rootMargin: '-120px 0px -60% 0px' },
  )
  for (const s of sections.value) {
    const el = document.getElementById(s.id)
    if (el) observer.observe(el)
  }
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div class="mx-auto flex max-w-[1240px] gap-10 px-6 pb-24 pt-[140px] lg:pt-[168px]">
    <div class="min-w-0 max-w-[860px] flex-1">
      <!-- ============ 图标 + 大标题（infron 文档页头同款） ============ -->
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
        {{ t('public.pricing.subtitle', { name: systemName }) }}
      </p>

      <!-- ============ Pricing Model：三条加粗要点 ============ -->
      <section class="mt-12">
        <h2 id="pricing-model" class="scroll-mt-24 text-[24px] font-bold tracking-tight">
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

      <!-- ============ Pricing Plans：搜索 + 双方案对比表 ============ -->
      <section class="mt-14">
        <h2 id="pricing-plans" class="scroll-mt-24 text-[24px] font-bold tracking-tight">
          {{ t('public.pricing.plansTitle') }}
        </h2>

        <!-- 表格顶部的行过滤搜索框（infron 同位） -->
        <div class="relative mt-5">
          <Search
            class="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <input
            v-model="search"
            type="search"
            :placeholder="t('public.pricing.searchPlaceholder')"
            class="h-10 w-full rounded-lg border border-border bg-bg pl-10 pr-4 text-[14px] outline-none transition-colors focus:border-border-selected"
          />
        </div>

        <div class="mt-3 overflow-hidden rounded-lg border border-border">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[640px] table-fixed text-[13.5px]">
              <colgroup>
                <col class="w-[22%]" />
                <col class="w-[39%]" />
                <col class="w-[39%]" />
              </colgroup>
              <thead>
                <tr class="border-b border-border bg-bg-subtle">
                  <th class="px-3 py-2.5" aria-hidden="true"></th>
                  <th class="border-l border-border px-4 py-2.5 text-center font-semibold">
                    {{ t('public.pricing.colPayg') }}
                  </th>
                  <th class="border-l border-border px-4 py-2.5 text-center font-semibold">
                    {{ t('public.pricing.colEnt') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in filteredRows"
                  :key="r.key"
                  class="border-b border-border align-top transition-colors last:border-0 hover:bg-bg-muted/50"
                >
                  <!-- 行标签列 -->
                  <th scope="row" class="px-3 py-3 text-left align-top font-medium">
                    {{ r.label }}
                    <RouterLink
                      v-if="r.learnMore"
                      :to="r.learnMore"
                      class="mt-0.5 block text-[12.5px] font-normal text-accent hover:underline"
                    >
                      {{
                        r.key === 'models'
                          ? t('public.pricing.row.exploreModels')
                          : t('public.pricing.learnMore')
                      }}
                    </RouterLink>
                  </th>

                  <!-- 两个方案列 -->
                  <td
                    v-for="col in (['payg', 'ent'] as const)"
                    :key="col"
                    class="border-l border-border px-4 py-3 align-top"
                  >
                    <template v-if="r[col].kind === 'check'">
                      <span role="img" aria-label="included">✅</span>
                    </template>

                    <template v-else-if="r[col].kind === 'text'">
                      <code
                        v-if="(r[col] as any).code"
                        class="rounded border border-border bg-bg-inset px-1.5 py-0.5 font-mono text-[12px]"
                      >{{ (r[col] as any).code }}</code>
                      <span v-if="(r[col] as any).suffix" class="ml-1.5 text-fg-secondary">
                        {{ (r[col] as any).suffix }}
                      </span>
                      <span v-if="(r[col] as any).text" class="leading-relaxed text-fg-secondary">
                        {{ (r[col] as any).text }}
                      </span>
                    </template>

                    <!-- 模型价格：0% 加价透传 / 企业最高 30% 折扣 -->
                    <template v-else-if="r[col].kind === 'rich' && (r[col] as any).slot === 'prices-payg'">
                      <p>
                        <code
                          class="rounded border border-border bg-bg-inset px-1.5 py-0.5 font-mono text-[12px]"
                        >0%</code>
                        <span class="ml-1.5">{{ t('public.pricing.row.markup') }}</span>
                      </p>
                      <p class="mt-2.5 leading-relaxed text-fg-secondary">
                        {{ t('public.pricing.row.passthrough', { name: systemName }) }}
                      </p>
                      <p class="mt-2.5 leading-relaxed text-fg-secondary">
                        {{ t('public.pricing.row.marketplacePre') }}
                        <RouterLink to="/models" class="text-accent underline hover:no-underline">
                          {{ t('public.pricing.row.marketplaceLink') }}</RouterLink>.
                      </p>
                    </template>

                    <template v-else-if="r[col].kind === 'rich' && (r[col] as any).slot === 'prices-ent'">
                      <p>
                        {{ t('public.pricing.row.upTo') }}
                        <code
                          class="mx-1 rounded border border-border bg-bg-inset px-1.5 py-0.5 font-mono text-[12px]"
                        >30%</code>
                        {{ t('public.pricing.row.off') }}
                      </p>
                      <p class="mt-2.5 leading-relaxed text-fg-secondary">
                        {{ t('public.pricing.row.entDiscount') }}
                      </p>
                      <p class="mt-2.5">
                        <RouterLink to="/about" class="text-accent underline hover:no-underline">
                          {{ t('public.pricing.row.bulkLink') }} ↗
                        </RouterLink>
                      </p>
                    </template>

                    <!-- 模型目录：400+ 模型 + 六类清单（两栏一致） -->
                    <template v-else-if="r[col].kind === 'rich' && (r[col] as any).slot === 'models'">
                      <p class="font-medium">{{ t('public.pricing.row.modelsCount') }}</p>
                      <ul class="mt-2 space-y-1.5 text-fg-secondary">
                        <li v-for="i in modelCats" :key="i" class="flex gap-2">
                          <span
                            class="mt-[8px] size-1 shrink-0 rounded-full bg-fg-subtle"
                            aria-hidden="true"
                          />
                          {{ t(`public.pricing.row.cat${i}`) }}
                        </li>
                      </ul>
                    </template>
                  </td>
                </tr>

                <tr v-if="!filteredRows.length">
                  <td colspan="3" class="px-4 py-12 text-center text-fg-subtle">
                    {{ t('public.pricing.emptyRows') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- ============ Important Notes：服务费说明 + 充值明细示例 ============ -->
      <section class="mt-14">
        <h2 id="important-notes" class="scroll-mt-24 text-[24px] font-bold tracking-tight">
          {{ t('public.pricing.notesTitle') }}
        </h2>
        <div class="mt-5 space-y-4 text-[14.5px] leading-relaxed text-fg-secondary">
          <p>{{ t('public.pricing.note1') }}</p>
          <p>{{ t('public.pricing.note2') }}</p>
          <p>{{ t('public.pricing.exampleIntro') }}</p>
        </div>

        <!-- $50 充值费用明细表 -->
        <div class="mt-4 max-w-[560px] overflow-hidden rounded-lg border border-border">
          <table class="w-full text-[13.5px]">
            <thead>
              <tr class="border-b border-border bg-bg-subtle text-left">
                <th class="px-4 py-2.5 font-semibold">{{ t('public.pricing.colDesc') }}</th>
                <th class="border-l border-border px-4 py-2.5 text-right font-semibold">
                  {{ t('public.pricing.colAmount') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-border">
                <td class="px-4 py-2.5">{{ t('public.pricing.exCredits') }}</td>
                <td class="border-l border-border px-4 py-2.5 text-right tabular">$50</td>
              </tr>
              <tr class="border-b border-border">
                <td class="px-4 py-2.5">{{ t('public.pricing.exFees') }}</td>
                <td class="border-l border-border px-4 py-2.5 text-right tabular">$2.85</td>
              </tr>
              <tr class="border-b border-border">
                <td class="px-4 py-2.5 font-medium">{{ t('public.pricing.exTotal') }}</td>
                <td class="border-l border-border px-4 py-2.5 text-right font-medium tabular">
                  $52.85
                </td>
              </tr>
              <tr>
                <td class="px-4 py-2.5">{{ t('public.pricing.exNet') }}</td>
                <td class="border-l border-border px-4 py-2.5 text-right tabular">$50</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ============ 收尾 CTA ============ -->
      <div class="mt-16 rounded-2xl border border-border bg-bg-subtle p-8 text-center">
        <h2 class="text-[22px] font-bold tracking-tight">
          {{ t('public.pricing.ctaTitle') }}
        </h2>
        <p class="mt-2 text-[14px] text-fg-muted">{{ t('public.pricing.ctaDesc') }}</p>
        <RouterLink
          to="/console"
          class="motion-press group mt-6 inline-flex h-10 items-center gap-2.5 rounded-[20px] bg-btn-primary-bg py-2 pl-[18px] pr-2 text-[14px] text-btn-primary-fg hover:-translate-y-px hover:opacity-88"
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

    <!-- ============ 右栏 ON THIS PAGE（infron 同款） ============ -->
    <aside class="hidden w-[200px] shrink-0 xl:block">
      <div class="sticky top-[120px]">
        <p
          class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"
        >
          <AlignLeft class="size-3.5" />
          {{ t('publicDocs.onThisPage') }}
        </p>
        <ul class="mt-3 space-y-1.5">
          <li v-for="s in sections" :key="s.id">
            <a
              :href="`#${s.id}`"
              class="block text-[13px] transition-colors"
              :class="
                activeAnchor === s.id ? 'font-medium text-accent' : 'text-fg-muted hover:text-fg'
              "
            >
              {{ s.text }}
            </a>
          </li>
        </ul>
      </div>
    </aside>
  </div>
</template>
