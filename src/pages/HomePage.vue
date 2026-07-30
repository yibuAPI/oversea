<script setup lang="ts">
/**
 * 落地页 —— 区块顺序与 infron.ai 实测一致：
 *   hero(700) → 客户条(180) → 模型库+数据(900) → 交替特性(2516)
 *   → 专家支持(829) → 证言(700) → 最新模型(1220) → FAQ(600)
 *   → CTA(454) → 页脚(451)
 *
 * 模型数据在这里取一次向下分发，避免两个区块各发一次请求。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useQuery } from '@tanstack/vue-query'
import { CircleAlert } from 'lucide-vue-next'
import SiteHeader from '@/components/layout/SiteHeader.vue'
import SiteFooter from '@/components/layout/SiteFooter.vue'
import HeroSection from '@/components/home/HeroSection.vue'
import TrustedBySection from '@/components/home/TrustedBySection.vue'
import ModelLibrarySection from '@/components/home/ModelLibrarySection.vue'
import FeatureSection from '@/components/home/FeatureSection.vue'
import SupportSection from '@/components/home/SupportSection.vue'
import TestimonialSection from '@/components/home/TestimonialSection.vue'
import LatestModelsSection, {
  type ModelCard,
} from '@/components/home/LatestModelsSection.vue'
import FaqSection from '@/components/home/FaqSection.vue'
import CtaSection from '@/components/home/CtaSection.vue'
import { useSiteStore } from '@/stores/site'
import { api } from '@/api/client'

const site = useSiteStore()
const { error } = storeToRefs(site)

/** New API 的定价基准：1 ratio = $0.002 / 1K token = $2 / 1M token */
const USD_PER_MILLION_PER_RATIO = 2

interface PricingRow {
  model_name?: string
  description?: string
  /** 逗号分隔的能力标签，如 "对话,思考"；含「弃用」的模型不展示 */
  tags?: string
  vendor_id?: number
  /** 0 = 按 token 计费（用 ratio），1 = 按次计费（用 model_price） */
  quota_type?: number
  model_ratio?: number
  completion_ratio?: number
  model_price?: number
}

interface Vendor {
  id?: number
  name?: string
}

/** /pricing 的完整响应体：data 在信封内，vendors 在信封外 */
interface PricingBody {
  data?: PricingRow[]
  vendors?: Vendor[]
}

/**
 * 公开定价接口。
 *
 * 这里必须用 api.raw 而不是 api.get：/pricing 把 vendors（厂商 id→名称表）
 * 挂在信封外层，api.get 解包后只剩 data 数组，vendors 会被丢掉。
 * 拿不到就让下游区块自行留空，不阻塞首屏。
 */
const { data: pricing } = useQuery({
  queryKey: ['home-pricing'],
  queryFn: () => api.raw<PricingRow[]>('/pricing') as Promise<PricingBody>,
  retry: 0,
  staleTime: 5 * 60_000,
})

/** 已弃用的模型不该出现在首页「最新上线」里 */
const rows = computed<PricingRow[]>(() => {
  const d = pricing.value?.data
  if (!Array.isArray(d)) return []
  return d.filter((r) => !(r.tags ?? '').includes('弃用'))
})

/** vendor_id → 厂商名，用于把卡片标题写成「厂商: 模型」 */
const vendorName = computed<Map<number, string>>(() => {
  const m = new Map<number, string>()
  for (const v of pricing.value?.vendors ?? []) {
    if (typeof v.id === 'number' && v.name) m.set(v.id, v.name)
  }
  return m
})

const modelCount = computed(() => rows.value.length || null)

/** 上游厂商数：只统计当前在售模型实际用到的厂商，不是 vendors 表的总条数 */
const providerCount = computed(() => {
  const ids = new Set<number>()
  for (const r of rows.value) {
    if (typeof r.vendor_id === 'number' && r.vendor_id > 0) ids.add(r.vendor_id)
  }
  return ids.size || null
})

/**
 * 定价换算：按 token 计费的模型把 ratio 折成每百万 token 美元价；
 * 按次计费（quota_type=1）的没有「每百万 token」概念，单独展示单价，
 * 不硬套单位 —— 标错价格比不标更糟。
 */
const latestModels = computed<ModelCard[]>(() =>
  rows.value
    .filter((r): r is PricingRow & { model_name: string } => !!r.model_name)
    .slice(0, 6)
    .map((r) => {
      const perToken = r.quota_type === 0
      const inRatio = typeof r.model_ratio === 'number' ? r.model_ratio : null
      const outRatio =
        inRatio !== null && typeof r.completion_ratio === 'number'
          ? inRatio * r.completion_ratio
          : null
      const vendor =
        typeof r.vendor_id === 'number' ? vendorName.value.get(r.vendor_id) : null
      /** 首个非空标签作为能力徽章，如「对话」「绘画」 */
      const tag = (r.tags ?? '').split(',').find((s) => s.trim()) ?? null

      return {
        id: r.model_name,
        name: r.model_name,
        vendor: vendor ?? null,
        tag,
        inputPrice:
          perToken && inRatio !== null
            ? inRatio * USD_PER_MILLION_PER_RATIO
            : null,
        outputPrice:
          perToken && outRatio !== null
            ? outRatio * USD_PER_MILLION_PER_RATIO
            : null,
        perCallPrice:
          !perToken && typeof r.model_price === 'number' ? r.model_price : null,
      } satisfies ModelCard
    }),
)

/**
 * 模型库右侧清单预览：只取按 token 计费的模型，展示真实每百万输入价。
 * 按次计费的混进来会出现两种单位并排，读起来是错的。
 *
 * 从 rows 全量里筛，不是从已截断的 latestModels —— 后者只有 6 条，
 * 其中按次计费的一去掉就凑不满一屏，卡片会矮半截。
 */
const libraryPreview = computed(() =>
  rows.value
    .filter(
      (r): r is PricingRow & { model_name: string; model_ratio: number } =>
        !!r.model_name && r.quota_type === 0 && typeof r.model_ratio === 'number',
    )
    .slice(0, 7)
    .map((r) => ({
      name: r.model_name,
      vendor:
        (typeof r.vendor_id === 'number'
          ? vendorName.value.get(r.vendor_id)
          : null) ?? '—',
      price: `$${(r.model_ratio * USD_PER_MILLION_PER_RATIO).toFixed(2)}/M`,
    })),
)
</script>

<template>
  <div class="relative min-h-dvh bg-bg text-fg">
    <SiteHeader />

    <main>
      <HeroSection />

      <!-- 后端不可达时的提示条；连通正常则完全不出现 -->
      <div v-if="error" class="mx-auto max-w-[1100px] px-6 pb-8">
        <div
          class="flex items-start gap-3 rounded-2xl border border-danger-border bg-danger-bg p-4"
        >
          <CircleAlert class="mt-0.5 size-5 shrink-0 text-danger-fg" />
          <p class="font-mono text-xs text-danger-fg">{{ error }}</p>
        </div>
      </div>

      <TrustedBySection />
      <ModelLibrarySection
        :model-count="modelCount"
        :provider-count="providerCount"
        :preview="libraryPreview"
      />
      <FeatureSection />
      <SupportSection />
      <TestimonialSection />
      <LatestModelsSection :models="latestModels" />
      <FaqSection />
      <CtaSection />
    </main>

    <SiteFooter />
  </div>
</template>
