<script setup lang="ts">
/**
 * 新版落地页 —— 参考图 1 布局，原首页（HomePage.vue）代码保留但不再挂路由。
 *
 * 区块顺序：
 *   hero(新，含厂商 logo 滚动行) → 交替特性 → 证言
 *   → 最新模型 → FAQ → CTA → 页脚
 *
 * 模型数据在这里取一次向下分发，避免各区块重复请求 —— 与旧首页一致。
 * 除 hero 外，其余区块全部复用现有组件。
 */
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useQuery } from '@tanstack/vue-query'
import { CircleAlert } from 'lucide-vue-next'
import SiteHeader from '@/components/layout/SiteHeader.vue'
import SiteFooter from '@/components/layout/SiteFooter.vue'
import NewHeroSection from '@/components/home/NewHeroSection.vue'
import type { VendorLogo } from '@/components/home/BrandLogoRow.vue'
import FeatureSection from '@/components/home/FeatureSection.vue'
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

/**
 * 鼠标跟随光晕 —— 铺满除页脚外的**整页**，不再只在 hero 里。
 *
 * 光斑是 position: fixed 的：直接吃 clientX/clientY，不用减容器 offset，
 * 也不用在滚动时重新量位置（fixed 的坐标系就是视口）。之前挂在 hero 上
 * 是 absolute，既要缓存 rect 又要监听 scroll 失效，滚动中还会漂。
 *
 * 事件挂在整个页面根节点上：pointermove 用捕获阶段的 window 监听即可，
 * 但页脚要排除 —— 见 onMove 里的 footer 命中判断。
 *
 * 性能：只动 translate + opacity，两者都在合成器上跑，不设 filter: blur()
 * （每帧重光栅一大块位图）也不设 will-change（见 index.css 的警告：会永久
 * 提升合成层、丢掉次像素抗锯齿，文字发虚）。柔边全靠 radial-gradient
 * 的多档 alpha 收尾。rAF 节流，一帧最多更新一次。
 */
const glowOn = ref(false)
/** 光斑中心的视口坐标 */
const glowPos = ref({ x: 0, y: 0 })
/** 页脚根节点，用来判断指针是否已经走到页脚区域 */
const footerEl = ref<HTMLElement | null>(null)
let raf = 0

/** 指针是否落在页脚上 —— 页脚是深色实心块，光晕压上去只会脏 */
function inFooter(y: number) {
  const el = footerEl.value
  if (!el) return false
  const top = el.getBoundingClientRect().top
  return y >= top
}

function onMove(e: PointerEvent) {
  // 触屏/笔不触发：没有 hover 概念，光斑跟着点击点闪一下反而突兀
  if (e.pointerType !== 'mouse') return
  const { clientX: x, clientY: y } = e
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    glowOn.value = !inFooter(y)
    glowPos.value = { x, y }
  })
}

/** 鼠标移出文档（切窗口、去浏览器 UI）时淡出，回来再淡入 */
function onLeaveDoc() {
  cancelAnimationFrame(raf)
  glowOn.value = false
}

onMounted(() => {
  window.addEventListener('pointermove', onMove, { passive: true })
  document.addEventListener('pointerleave', onLeaveDoc)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('pointermove', onMove)
  document.removeEventListener('pointerleave', onLeaveDoc)
})

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
 * 必须用 api.raw 而不是 api.get：/pricing 把 vendors 挂在信封外层，
 * api.get 解包后只剩 data 数组，vendors 会被丢掉。
 * 拿不到就让下游区块自行留空，不阻塞首屏。
 */
const { data: pricing } = useQuery({
  queryKey: ['home-pricing'],
  queryFn: () => api.raw<PricingRow[]>('/pricing') as Promise<PricingBody>,
  retry: 0,
  staleTime: 5 * 60_000,
})

/** 已弃用的模型不该出现在首页 */
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
 * 厂商 logo 滚动条 —— 图 2 那排白色圆角卡片。
 *
 * 只列**厂商**，不列模型：定制模型/中转模型压根没有官方图标，按模型名
 * 铺出来必然一半是首字母色块，参考站那排也全是厂商标。十个足够撑满一屏
 * 的滚动，再多只是重复。
 *
 * src 指向 public/vendors/ 下的本地 PNG（从 lobehub 静态包取的官方标，
 * 已核对逐个 200 且是真 PNG）。改成本地是因为原先走 unpkg CDN：国内网络
 * 经常拿不到，整排就退化成彩色首字母，看着像坏图。本地文件跟着构建走，
 * 离线也稳定。
 */
const vendorLogos: VendorLogo[] = [
  { src: '/vendors/openai.png', name: 'OpenAI' },
  { src: '/vendors/claude.png', name: 'Claude' },
  { src: '/vendors/gemini.png', name: 'Gemini' },
  { src: '/vendors/deepseek.png', name: 'DeepSeek' },
  { src: '/vendors/qwen.png', name: '通义千问' },
  { src: '/vendors/kimi.png', name: 'Kimi' },
  { src: '/vendors/zhipu.png', name: '智谱' },
  { src: '/vendors/moonshot.png', name: 'Moonshot' },
  { src: '/vendors/mistral.png', name: 'Mistral' },
  { src: '/vendors/meta.png', name: 'Meta' },
]
</script>

<template>
  <div class="glow-page relative min-h-dvh bg-bg text-fg">
    <SiteHeader />

    <!-- 鼠标跟随光晕：fixed 铺满视口，浮在**所有内容之上**（z-40，唯一例外是
         更顶层的 z-50 导航）。
         之前它是 z-0 压在 main（z-10）底下，等于从半透明的 hero-backdrop 背后
         透出 —— backdrop 的 alpha（0.72）把光晕衰减成 28%，而往下越过边界后
         白底上光晕是 100%。同一条光斑在界线两侧强度差 3.5 倍，这就是光晕一
         激活就"显形"出硬边的根因。移到内容之上后，无论底下是 backdrop 还是
         白底，光晕都以同一强度叠上去，边界处不再有强度跳变，这也对页面上任何
         半透明区块交界处通治。
         只动 translate + opacity；pointer-events-none 不挡点击。 -->
    <div
      class="glow pointer-events-none fixed left-0 top-0 z-40 size-[1100px]"
      :class="{ 'glow-on': glowOn }"
      :style="{ translate: `${glowPos.x - 550}px ${glowPos.y - 550}px` }"
      aria-hidden="true"
    />

    <main class="relative z-10">
      <NewHeroSection :vendors="vendorLogos" />

      <!-- 后端不可达时的提示条；连通正常则完全不出现 -->
      <div v-if="error" class="mx-auto max-w-[1400px] px-6 pb-8">
        <div
          class="flex items-start gap-3 rounded-2xl border border-danger-border bg-danger-bg p-4"
        >
          <CircleAlert class="mt-0.5 size-5 shrink-0 text-danger-fg" />
          <p class="font-mono text-xs text-danger-fg">{{ error }}</p>
        </div>
      </div>

      <FeatureSection />
      <TestimonialSection />
      <LatestModelsSection :models="latestModels" />
      <FaqSection />
      <CtaSection />
    </main>

    <!-- ref 挂在包裹 div 上而不是 <SiteFooter> 上：组件上的 ref 拿到的是
         组件实例，不是 DOM 节点，取不到 getBoundingClientRect。
         这个盒子的顶边就是「光晕该熄灭」的分界线。 -->
    <div ref="footerEl" class="relative z-10">
      <SiteFooter />
    </div>
  </div>
</template>

<style scoped>
/* 鼠标跟随的紫蓝光晕。
   柔边全靠径向渐变的多档 alpha 收尾 —— 不用 filter: blur()，那会让浏览器
   每帧重新光栅化一大块位图；也不用 will-change（见 index.css 的警告：
   永久提升合成层会丢掉次像素抗锯齿，静止时文字都发虚）。
   只动 translate 和 opacity，两者都能交给合成器。

   透明度刻意压得很低（峰值 0.14）：这是背景氛围，不是聚光灯。
   之前 0.32 太抢眼，指针一动整块页面跟着发紫。 */
.glow {
  border-radius: 9999px;
  background: radial-gradient(
    circle at 50% 50%,
    rgba(139, 92, 246, 0.14) 0%,
    rgba(139, 92, 246, 0.09) 30%,
    rgba(47, 107, 255, 0.05) 55%,
    transparent 72%
  );
  opacity: 0;
  transition:
    opacity 0.45s ease,
    translate 120ms ease-out;
}

.dark .glow {
  background: radial-gradient(
    circle at 50% 50%,
    rgba(167, 139, 250, 0.2) 0%,
    rgba(167, 139, 250, 0.12) 30%,
    rgba(96, 150, 240, 0.07) 55%,
    transparent 72%
  );
}

/* 指针在页面上（且不在页脚）：淡入。
   120ms 的 ease-out 让光斑略微滞后于指针，带一点拖拽的分量感。 */
.glow.glow-on {
  opacity: 1;
}

/* 光晕现在浮在内容之上（z-40，见模板注释），可见性不依赖下游底色是否
   透明 —— 之前把 .bg-bg-elevated 压到 82%、.bg-black 压到 0.88，是为了让
   压在底下的光晕透上来；现在光晕在上层，那些半透明覆盖没用了，还原成
   区块本来得不透明。整页任何区块交界处光晕都同强度叠加，不再有硬边。 */

/* 关掉动效偏好时光斑不跟手，直接不出现 —— 一个跟着鼠标跑的大色块
   正是这类偏好想避免的东西。base 层只压时长，这里彻底隐藏。 */
@media (prefers-reduced-motion: reduce) {
  .glow {
    display: none;
  }
}
</style>
