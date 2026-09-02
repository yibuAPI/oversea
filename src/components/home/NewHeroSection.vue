<script setup lang="ts">
/**
 * 首页 hero —— 对齐参考站 api.openlux.ai 的版式：
 *
 *   左栏自上而下：巨幅渐变字标 → 标题 → 副标题 → 两个按钮
 *                → 「500+ 大模型已经接入」小灰标签 → 厂商 logo 滚动行
 *   右栏：产品视觉（对话卡 + 中央堆叠方块 + 六枚徽章，
 *        每枚徽章有一条线连回中心，线上有小圆循环滑出）
 *
 * 版式要点（与参考站一致，别再倒过来）：
 *   字标是全页最大的元素，标题比它小且为常规字重 —— 品牌先声夺人，
 *   标题退居其次。之前做反了：标题 64px 压过 20px 的字标。
 *
 *   「500+」与 logo 行属于左栏内容，不是通栏区块；它们跟着左栏的
 *   文字左边缘对齐，右侧不越过中线，否则会横穿到视觉图下方。
 *
 * 背景用淡紫白渐变铺满，不再用 /hero-gradient.png ——
 * 那张图是深蓝实色，会盖住右栏内容且与参考站的柔和调性相反。
 */
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { onMounted, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { storeToRefs } from 'pinia'
import {
  CircleDollarSign,
  Zap,
  UserRound,
  ShieldCheck,
  Users,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import BrandLogoRow, { type VendorLogo } from '@/components/home/BrandLogoRow.vue'

defineProps<{ vendors?: VendorLogo[] }>()

const { t } = useI18n()
const { systemName } = storeToRefs(useSiteStore())

/** 是否要求减少动效：SDK 上 SWE 里 SMIL 不在 CSS 兜底范围内，
    这里用 rAF 自绘动画，直接跟着这个开关起停。 */
const prefersReducedMotion = ref(false)
let reducedMotionQuery: MediaQueryList | null = null
function syncReducedMotion() {
  const reduce = reducedMotionQuery?.matches ?? false
  prefersReducedMotion.value = reduce
  // 用户开着 reduced-motion：停掉循环、小圆隐藏；否则跑起来
  if (reduce) stopDotLoopAll()
  else startDotLoop()
}
onMounted(() => {
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncReducedMotion()
  reducedMotionQuery.addEventListener('change', syncReducedMotion)
})
onBeforeUnmount(() => {
  reducedMotionQuery?.removeEventListener('change', syncReducedMotion)
  stopDotLoopAll()
})

/**
 * 徽章：绕着中央视觉散开，位置按参考站的疏密关系摆。
 * tone 决定图标底色，对应参考站每枚徽章不同的点缀色。
 *
 * 视觉区按 400×340 的坐标系摆放，所有元素共用这一套坐标：
 *   - 徽章本体：由 x/y 换算成百分比定位；
 *   - 连接线：从中心 (200,170) 指向徽章的一条同向弯的曲线；
 *   - 滑动小圆：沿着这条线反复滑到徽章。
 *
 * 徽章自身静止不飘（否则文字发糊），只有线上的小圆在动。
 * x/y 是徽章**中心点**在 400×340 里的坐标。
 *
 * 坐标别再往外推：视觉框会随断点缩放，而徽章里的文字是固定 px，
 * 窄一点的 lg 下框变小、字不变，靠边的几枚就会顶出框去。
 * 现在这组值在 lg 最窄处仍留有余量。
 */
const CX = 200
const CY = 170

const badges = [
  { icon: CircleDollarSign, key: 'transparent', x: 90, y: 42, tone: 'bg-blue-100 text-blue-600' },
  { icon: Zap, key: 'concurrency', x: 328, y: 46, tone: 'bg-amber-100 text-amber-600' },
  /** 参考站这枚只有图标、没有文字，所以能贴得比别的更靠边 */
  { icon: UserRound, key: 'ops', x: 378, y: 172, tone: 'bg-violet-100 text-violet-600', iconOnly: true },
  { icon: ShieldCheck, key: 'stability', x: 332, y: 282, tone: 'bg-emerald-100 text-emerald-600' },
  { icon: CircleDollarSign, key: 'metered', x: 96, y: 286, tone: 'bg-violet-100 text-violet-600' },
  { icon: Users, key: 'support', x: 196, y: 314, tone: 'bg-sky-100 text-sky-600' },
]

/**
 * 由徽章坐标解出连接线的几何量。
 *
 * 线是 SVG 里一条二次贝塞尔曲线（Q）：从中心弯向徽章。取中心→徽章
 * 直线段的中点，沿垂直方向 (-dy, dx) 偏移一段与距离成正比的距离作控制点，
 * 让每条线朝同一侧弯曲、形成环绕感。坐标始终用 400×340 空间，与徽章的
 * 百分比定位一一对应 —— 卡片 / 徽章是多少，线就落在多少。
 *
 * 徽章静态定位用的还是 leftPct / topPct（百分比），两者坐标系一致。
 */
const nodes = badges.map((b, i) => {
  const dx = b.x - CX
  const dy = b.y - CY
  const len = Math.hypot(dx, dy)
  const midX = (CX + b.x) / 2
  const midY = (CY + b.y) / 2
  /** 垂直偏移量：与距离成正比，弯得均匀（再大曲线会甩出框） */
  const bend = len * 0.22
  const cx = midX + (-dy / len) * bend
  const cy = midY + (dx / len) * bend
  return {
    ...b,
    /** 控制点：rAF 沿贝塞尔采样坐标时用 */
    cx,
    cy,
    /** 徽章中心的定位百分比 */
    leftPct: `${(b.x / 400) * 100}%`,
    topPct: `${(b.y / 340) * 100}%`,
    /** 中心 → 徽章的曲线路径（曲线线条的 d 属性） */
    path: `M ${CX} ${CY} Q ${cx} ${cy} ${b.x} ${b.y}`,
    /** 六枚小圆依次出发，绕着中心一圈圈扩散，而不是齐刷刷同时动 */
    delay: i * 0.62,
  }
})

/* ── 小圆动画：沿曲线从中心滑到徽章。

   原实现是 SMIL `<animateMotion>`，但在这套 Vue 渲染出的 SVG 里行为不稳定
   （点要么不走、要么整组不显示）。改成 requestAnimationFrame 手动推进：
   每帧用二次贝塞尔公式算 t 时刻坐标、translate 到对应 <g> 上，可见度包络
   由自己控制，也能跟着 prefersReducedMotion 一起停，不再依赖 SMIL。 */

/** 每轮时长（秒） */
const DOT_DUR = 3.8

/** 每枚小圆 <g> 的引用：v-for 渲染后按 index 组成数组，rAF 循环按序取 */
const dotEls = useTemplateRef<SVGGElement[]>('dotEls')

/** 二次贝塞尔取点：P0=中心、C=控制点、P2=徽章中心 */
function curvePoint(t: number, n: (typeof nodes)[number]) {
  const u = 1 - t
  return [
    u * u * CX + 2 * u * t * n.cx + t * t * n.x,
    u * u * CY + 2 * u * t * n.cy + t * t * n.y,
  ]
}

/** 可见包络（对应一轮进度 0..1）：进场快、中段保持、末尾淡出 */
function dotOpacity(t: number) {
  if (t < 0.06) return t / 0.06
  if (t < 0.46) return 1
  if (t < 0.52) return 1 - (t - 0.46) / 0.06
  return 0
}

let stopDotLoop: (() => void) | null = null
function startDotLoop() {
  if (stopDotLoop) return
  const epoch = performance.now()
  let raf = 0
  const tick = (now: number) => {
    nodes.forEach((n, i) => {
      const el = dotEls.value?.[i]
      if (!el) return
      /** 相对出发时刻、取模进一轮 [0,1) 的进度 */
      const local = (now - epoch) / 1000 - n.delay
      const t = (((local % DOT_DUR) + DOT_DUR) % DOT_DUR) / DOT_DUR
      const [x, y] = curvePoint(Math.min(t / 0.52, 1), n)
      el.setAttribute('opacity', String(dotOpacity(t)))
      el.setAttribute('transform', `translate(${x} ${y})`)
    })
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  stopDotLoop = () => cancelAnimationFrame(raf)
}
function stopDotLoopAll() {
  stopDotLoop?.()
  stopDotLoop = null
  // 归位隐藏：reduced-motion 下小圆不杵在中心
  nodes.forEach((_, i) => dotEls.value?.[i]?.setAttribute('opacity', '0'))
}
</script>

<template>
  <section class="relative overflow-hidden">
    <!-- 淡紫白背景铺底，纯装饰。
         注意 z-0 而不是 -z-10：负 z-index 的元素会「穿透」到最近的层叠
         上下文里去，而 NewHomePage 最外层是 .relative.bg-bg（不透明白底、
         定位元素但 z-index:auto，不构成层叠上下文），负层会被盖在它的
         白底之下 —— 整块背景直接消失。内容区靠 z-10 压在这两层之上。

         这层带 alpha：鼠标光晕现在挂在 NewHomePage 上、铺满整页（见那边
         的注释），画在本区块**下面**。不透明底色会把它整块挡住，所以这里
         用半透明渐变，让光晕透上来。 -->
    <div
      class="hero-backdrop pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(160deg,rgba(251,250,255,0.72)_0%,rgba(246,244,255,0.66)_45%,rgba(242,246,255,0.72)_100%)] dark:bg-[linear-gradient(160deg,rgba(11,11,15,0.72)_0%,rgba(18,16,24,0.66)_50%,rgba(13,16,24,0.72)_100%)]"
      aria-hidden="true"
    />

    <div
      class="relative z-10 mx-auto grid max-w-[1640px] grid-cols-1 items-center gap-12 px-6 pb-16 pt-[120px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-44 lg:px-[72px] lg:pb-24 lg:pt-[176px]"
    >
      <!-- ── 左栏 ── -->
      <div class="min-w-0">
        <!-- 字标：全页最大元素 -->
        <p
          class="text-hero-gradient text-[54px] font-bold leading-[1.05] tracking-[-0.03em] lg:text-[64px]"
        >
          {{ systemName }}
        </p>

        <h1
          class="mt-5 text-[34px] font-normal leading-[1.15] tracking-[-0.02em] text-fg lg:text-[42px]"
        >
          {{ t('homeNew.hero.line1') }}<br />{{ t('homeNew.hero.line2') }}
        </h1>

        <p
          class="mt-5 max-w-[640px] text-[17px] leading-[1.65] text-fg-secondary"
        >
          {{ t('homeNew.hero.subtitle') }}
        </p>

        <div class="mt-9 flex flex-wrap items-center gap-4">
          <RouterLink
            to="/console"
            class="hero-cta motion-press bg-hero-gradient inline-flex h-[56px] items-center rounded-full px-8 text-[16px] font-semibold text-white shadow-[0_8px_24px_-8px_rgba(123,80,246,0.7)]"
          >
            {{ t('homeNew.hero.primaryCta') }}
          </RouterLink>

          <RouterLink
            to="/docs"
            class="motion-press inline-flex h-[56px] items-center rounded-full border border-border bg-bg-elevated px-8 text-[16px] font-semibold text-fg shadow-sm hover:bg-bg-muted"
          >
            {{ t('homeNew.hero.secondaryCta') }}
          </RouterLink>
        </div>

        <!-- 「500+」+ logo 行：属于左栏，跟着上面的文字左对齐 -->
        <p class="mt-14 text-[15px] font-medium text-fg-muted">
          {{ t('homeNew.models.title') }}
        </p>
        <BrandLogoRow :vendors="vendors" class="mt-4" />
      </div>

      <!-- ── 右栏产品视觉：纯装饰，小屏隐藏 ── -->
      <div class="relative hidden aspect-[4/3.4] w-full lg:block" aria-hidden="true">
        <!-- 中央同心圆背景 -->
        <div
          class="absolute left-1/2 top-1/2 size-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-200/60 dark:border-violet-500/15"
        />
        <div
          class="absolute left-1/2 top-1/2 size-[88%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-200/40 dark:border-violet-500/10"
        />

        <!-- 中心 → 各徽章的连接线：二次贝塞尔曲线。
             SVG 与徽章共用 400×340 viewBox，随容器等比缩放，两端仍精确
             落在中心与徽章中心。放在堆叠方块 / 对话卡之前，让不透明元素
             自然盖住线的根部，不用额外调 z-index。
             线色走 CSS 变量命中主题（light 用 rayLight 渐变、dark 用 rayDark），
             滑动小圆沿同一路径 (animateMotion) 从中心滑到徽章。 -->
        <svg
          class="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 400 340"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <radialGradient
              id="rayLight"
              gradientUnits="userSpaceOnUse"
              cx="200"
              cy="170"
              r="230"
            >
              <stop offset="0%" stop-color="rgba(139,92,246,0.45)" />
              <stop offset="100%" stop-color="rgba(139,92,246,0.06)" />
            </radialGradient>
            <radialGradient
              id="rayDark"
              gradientUnits="userSpaceOnUse"
              cx="200"
              cy="170"
              r="230"
            >
              <stop offset="0%" stop-color="rgba(167,139,250,0.5)" />
              <stop offset="100%" stop-color="rgba(167,139,250,0.05)" />
            </radialGradient>
            <filter id="rayGlow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.5" />
            </filter>
          </defs>

          <g class="ray-line">
            <path
              v-for="n in nodes"
              :key="`curve-${n.key}`"
              :d="n.path"
              stroke-width="1"
            />
          </g>

          <!-- 依序出发的小圆：rAF 沿贝塞尔曲线推进（见 script 的 startDotLoop），
               每帧写 opacity + translate 到这个 <g> 上。base opacity=0 兜底。 -->
          <g
            v-for="n in nodes"
            :key="`dot-${n.key}`"
            ref="dotEls"
            class="ray-dot-g"
            opacity="0"
          >
            <circle r="6" class="ray-dot-halo" filter="url(#rayGlow)" />
            <circle r="3.5" class="ray-dot" />
          </g>
        </svg>

        <!-- 中央堆叠方块（已换成自定义 PNG 插画） -->
        <img
          src="/model-library.png"
          alt=""
          class="absolute left-1/2 top-1/2 w-[176px] -translate-x-1/2 -translate-y-1/2 object-contain drop-shadow-sm"
        />

        <!-- 左侧对话卡 -->
        <div
          class="absolute left-0 top-[30%] w-[230px] overflow-hidden rounded-2xl border border-border bg-bg-elevated shadow-[0_12px_32px_-12px_rgba(76,29,149,0.28)]"
        >
          <div class="flex items-center gap-1.5 border-b border-border px-3 py-2">
            <span class="size-2 rounded-full bg-red-400" />
            <span class="size-2 rounded-full bg-amber-400" />
            <span class="size-2 rounded-full bg-emerald-400" />
            <span class="ml-1.5 h-1.5 flex-1 rounded-full bg-bg-inset" />
          </div>
          <div class="p-3">
            <p
              class="rounded-lg border border-border bg-bg-muted px-2.5 py-2 text-[11px] leading-[15px] text-fg-secondary"
            >
              {{ t('homeNew.demo.prompt') }}
            </p>
            <div class="mt-2.5 flex items-center gap-2">
              <span
                class="relative h-4 w-7 rounded-full bg-hero-gradient after:absolute after:right-0.5 after:top-0.5 after:size-3 after:rounded-full after:bg-white"
              />
              <span
                class="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
              >
                {{ t('homeNew.demo.tag') }}
              </span>
            </div>
            <p class="mt-3 text-[13px] font-bold leading-tight text-violet-600 dark:text-violet-300">
              {{ t('homeNew.badges.ops') }}
            </p>
            <p class="mt-1.5 text-[11px] leading-[15px] text-fg-secondary">
              {{ t('homeNew.demo.reply') }}
            </p>
          </div>
        </div>

        <!-- 六枚徽章：定位在线的另一头，自身静止（文字才不会发糊）。
             hover 上浮提亮。 -->
        <div
          v-for="n in nodes"
          :key="n.key"
          class="node-badge absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-border bg-bg-elevated/95 py-2 shadow-[0_6px_20px_-8px_rgba(76,29,149,0.35)] backdrop-blur"
          :class="[n.iconOnly ? 'px-2' : 'px-3.5']"
          :style="{ left: n.leftPct, top: n.topPct }"
        >
          <span
            class="badge-dot grid size-5 shrink-0 place-items-center rounded-full"
            :class="n.tone"
          >
            <component :is="n.icon" class="size-3" />
          </span>
          <span
            v-if="!n.iconOnly"
            class="whitespace-nowrap text-[13px] font-medium text-fg"
          >
            {{ t(`homeNew.badges.${n.key}`) }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* hero 底部的淡紫背景一定要"淡出"而不是"停在被白底截断"。
   渐变是 160deg 斜向：100% 停靠点落在盒子右下角（≈y=973），而区块在
   y=761 就结束，所以沿可见底边只走到 ~78% 进度、还带着约 0.5 的不透明度，
   直接撞上 #fff → 一条全宽硬线。
   用 mask 给整块做**竖直** alpha 渐隐（与斜向渐变无关），让底边在任何
   横向位置都平滑过渡到透明、露出页面白底。 */
.hero-backdrop {
  -webkit-mask-image: linear-gradient(to bottom, #000 65%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 65%, transparent 100%);
}

/* 右栏视觉。
   整体保持静止 —— 整块漂移会把文字拖糊（见 src/styles/index.css 里对
   will-change 的警告）。唯一在动的是连接线上那枚小圆：
   它从中心出发，沿着一根根曲线向外滑到徽章（SVG animateMotion）。 */

/* 连接线：颜色走 CSS 变量，dark 下整体切换成更亮的紫。
   变量在模板 .ray-line / .ray-dot 上定义，本样式 scoped 只负责命中类名。 */
.ray-line path {
  stroke: url(#rayLight);
}
.dark .ray-line path {
  stroke: url(#rayDark);
}

/* 滑动小圆：base 透明度放在 <g> 的 opacity **属性**上（见模板），
   因为 SMIL animate 动的正是这个 presentation attribute ——
   CSS 声明的优先级高于它，这里若再写 opacity 会把小圆永久压隐形。
   动画 keyTimes 会在播放时覆盖属性值。 */
.ray-dot {
  fill: #8b5cf6;
}
.dark .ray-dot {
  fill: #a78bfa;
}
.ray-dot-halo {
  fill: #8b5cf6;
  opacity: 0.55;
}
.dark .ray-dot-halo {
  fill: #a78bfa;
  opacity: 0.5;
}

/* 徽章静止定位，hover 时上浮放大提亮。
   从漂移动画里解放出来后，transform 可以放心用 ——
   居中靠的是独立 translate 属性，和 transform 叠加生效。 */
.node-badge {
  transition:
    transform var(--duration-base) var(--ease-out),
    box-shadow var(--duration-base) var(--ease-out),
    border-color var(--duration-base) var(--ease-out);
}
.node-badge:hover {
  border-color: var(--hero-purple);
  transform: translateY(-3px) scale(1.06);
  box-shadow: 0 14px 28px -10px rgba(76, 29, 149, 0.42);
}
.node-badge .badge-dot {
  transition: transform var(--duration-base) var(--ease-out);
}
.node-badge:hover .badge-dot {
  transform: scale(1.12);
}

/* 主 CTA：按住由 .motion-press 缩放；这里管 hover。
   background-size 放大 + position 位移，让蓝紫渐变在悬停时流动。
   translate 与 motion-press 的 transform 互不干扰，可同时上浮。 */
.hero-cta {
  transition-property: box-shadow, translate, background-size, background-position;
  transition-timing-function: var(--ease-out);
  transition-duration: var(--duration-base);
  background-size: 150% 150%;
  background-position: 0% 50%;
}
.hero-cta:hover {
  translate: 0 -2px;
  background-position: 100% 50%;
  box-shadow: 0 14px 32px -8px rgba(123, 80, 246, 0.85);
}

/* 尊重系统偏好：小圆不再滑动，只留在中心（藏起来）。
   reduced-motion 是**模板**用 prefersReducedMotion 关的 ——
   不渲染 SVG 里的 animateMotion / animate，小圆停在 base opacity=0。 */
</style>
