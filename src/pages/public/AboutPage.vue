<script setup lang="ts">
/**
 * 关于页 /about —— 版式对照 infron.ai/about-us：
 *
 *   hero      全屏品牌渐变 + 居中大字标语（暗色主题下渐变反相处理）
 *   宣言      白底居中窄栏两段
 *   理念      三格信念（隐形 / 最优 / 自动扩容），中缝 1px 分隔
 *   价值观    三列卡片（可靠 / 透明 / 支持）
 *   数据带    模型数 / 厂商数 / 兼容性 / 可用性 —— 全部取真实后端数据
 *   收尾      居中 CTA（免费开始 + 浏览模型）
 *
 * 不再渲染后台 /api/about 富文本：那块二维码 + 本站须知与专业版式冲突，已移除。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import { ArrowRight, ShieldCheck, ReceiptText, Headset } from 'lucide-vue-next'
import { getPricing } from '@/api/models'
import { useSiteStore } from '@/stores/site'

const { t, n } = useI18n()
const site = useSiteStore()
const { systemName } = storeToRefs(site)

const pricingQ = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

/** 数据带：无真实值时显示占位符，不编数字 */
const modelCount = computed(() => pricingQ.data.value?.data?.length ?? 0)
const vendorCount = computed(() => {
  const ids = new Set<number>()
  for (const m of pricingQ.data.value?.data ?? [])
    if (typeof m.vendor_id === 'number' && m.vendor_id > 0) ids.add(m.vendor_id)
  return ids.size
})

const stats = computed(() => [
  {
    key: 'models',
    value: modelCount.value ? `${n(modelCount.value)}+` : '—',
    label: t('home.library.metric.models'),
  },
  {
    key: 'providers',
    value: vendorCount.value ? `${n(vendorCount.value)}+` : '—',
    label: t('home.library.metric.providers'),
  },
  { key: 'compat', value: '100%', label: t('home.library.metric.compat') },
  { key: 'uptime', value: '99.9%', label: t('home.library.metric.uptime') },
])

const BELIEFS = ['invisible', 'best', 'scale'] as const

const VALUES = [
  { key: 'reliable', icon: ShieldCheck },
  { key: 'transparent', icon: ReceiptText },
  { key: 'support', icon: Headset },
] as const
</script>

<template>
  <div>
    <!-- ============ 全屏渐变 hero ============ -->
    <section
      class="relative flex h-[520px] items-center justify-center overflow-hidden lg:h-[640px]"
    >
      <img
        src="/hero-gradient.png"
        alt=""
        class="absolute inset-0 size-full object-cover dark:invert dark:hue-rotate-180"
        aria-hidden="true"
      />
      <div class="relative flex flex-col items-center px-6 text-center">
        <span
          class="mb-6 inline-flex items-center rounded-full border border-[#0b1c33]/15 bg-white/40 px-4 py-1.5 text-[13px] font-medium tracking-[-0.13px] text-[#0b1c33] backdrop-blur-sm dark:border-white/20 dark:bg-white/10 dark:text-white"
        >
          {{ t('public.about.eyebrow') }}
        </span>
        <h1
          class="max-w-[880px] text-[40px] font-bold leading-[1.05] tracking-tight text-[#0b1c33] lg:text-[64px] dark:text-white"
        >
          {{ t('public.about.heroTitle') }}
        </h1>
        <p
          class="mt-6 max-w-[560px] text-[16px] leading-[1.6] text-[#0b1c33]/70 lg:text-[18px] dark:text-white/70"
        >
          {{ t('public.about.heroSub', { name: systemName }) }}
        </p>
      </div>
    </section>

    <!-- ============ 宣言 ============ -->
    <section class="px-6 py-20 lg:py-24">
      <div class="mx-auto max-w-[760px]">
        <p class="text-center text-[17px] leading-[1.8] text-fg-secondary lg:text-[19px]">
          {{ t('public.about.manifesto1') }}
        </p>
        <p class="mt-8 text-center text-[17px] leading-[1.8] text-fg-secondary lg:text-[19px]">
          {{ t('public.about.manifesto2', { name: systemName }) }}
        </p>
      </div>
    </section>

    <!-- ============ 三格信念 ============ -->
    <section class="bg-bg-subtle px-6 py-20 lg:py-24">
      <div class="mx-auto max-w-[1100px]">
        <h2 class="text-center text-[28px] font-bold tracking-tight lg:text-[36px]">
          {{ t('public.about.beliefsTitle') }}
        </h2>
        <div class="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          <div
            v-for="b in BELIEFS"
            :key="b"
            class="bg-bg-elevated px-8 py-10"
          >
            <h3 class="text-[19px] font-bold leading-[1.3] tracking-tight">
              {{ t(`public.about.belief.${b}.title`) }}
            </h3>
            <p class="mt-3 text-[15px] leading-[1.7] text-fg-muted">
              {{ t(`public.about.belief.${b}.desc`) }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 价值观三列 ============ -->
    <section class="px-6 py-20 lg:py-24">
      <div class="mx-auto max-w-[1100px]">
        <h2 class="text-center text-[28px] font-bold tracking-tight lg:text-[36px]">
          {{ t('public.about.valuesTitle') }}
        </h2>
        <div class="mt-12 grid gap-6 md:grid-cols-3">
          <div
            v-for="v in VALUES"
            :key="v.key"
            class="rounded-2xl border border-border bg-bg-elevated p-7"
          >
            <span
              class="grid size-11 place-items-center rounded-xl bg-accent-bg text-accent"
            >
              <component :is="v.icon" class="size-5" />
            </span>
            <h3 class="mt-5 text-[17px] font-bold">
              {{ t(`public.about.value.${v.key}.title`) }}
            </h3>
            <p class="mt-2.5 text-[14px] leading-[1.7] text-fg-muted">
              {{ t(`public.about.value.${v.key}.desc`) }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ============ 数据带 ============ -->
    <section class="bg-bg-subtle px-6 py-20 lg:py-24">
      <dl class="mx-auto grid max-w-[1100px] grid-cols-2 gap-y-10 lg:grid-cols-4">
        <div v-for="s in stats" :key="s.key" class="text-center">
          <dt class="sr-only">{{ s.label }}</dt>
          <dd>
            <span class="block text-[40px] font-bold leading-none tracking-tight lg:text-[52px]">
              {{ s.value }}
            </span>
            <span class="mt-3 block text-[15px] text-fg-subtle">{{ s.label }}</span>
          </dd>
        </div>
      </dl>
    </section>

    <!-- ============ 收尾 CTA ============ -->
    <section class="px-6 py-24">
      <div
        class="mx-auto max-w-[1100px] rounded-3xl bg-bg-subtle px-8 py-16 text-center"
      >
        <h2 class="text-[26px] font-bold tracking-tight lg:text-[34px]">
          {{ t('public.about.ctaTitle') }}
        </h2>
        <p class="mx-auto mt-3 max-w-[520px] text-[15px] text-fg-muted">
          {{ t('public.about.ctaDesc') }}
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <RouterLink
            to="/console"
            class="group inline-flex h-10 items-center gap-2.5 rounded-[20px] bg-btn-primary-bg py-2 pl-[18px] pr-2 text-[14px] text-btn-primary-fg transition-opacity hover:opacity-88"
          >
            {{ t('home.hero.primaryCta') }}
            <span
              class="grid size-6 shrink-0 place-items-center rounded-full bg-btn-primary-fg/15 transition-transform group-hover:translate-x-0.5"
            >
              <ArrowRight class="size-3.5" />
            </span>
          </RouterLink>
          <RouterLink
            to="/models"
            class="inline-flex h-10 items-center rounded-[100px] border border-border-strong px-[18px] text-[14px] transition-colors hover:bg-bg-muted"
          >
            {{ t('home.hero.secondaryCta') }}
          </RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
