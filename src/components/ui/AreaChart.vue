<script setup lang="ts">
/**
 * 面积/柱状图。手写 SVG 而非引第三方库 ——
 * 这里只需要单序列时间轴，装 echarts 会多出几百 KB。
 *
 * 坐标系用 viewBox 归一化到 1000×H，靠 CSS 拉伸铺满容器，
 * 因此不需要监听 resize。
 */
import { computed, ref } from 'vue'

export interface Point {
  /** unix 秒，仅用于 tooltip 标签 */
  t: number
  v: number
  label: string
}

const props = withDefaults(
  defineProps<{
    points: Point[]
    /** tooltip 里数值的格式化 */
    format?: (v: number) => string
    /** bar 更适合稀疏的按天数据，area 适合密集的按小时数据 */
    kind?: 'area' | 'bar'
    /** bar 填充色；area 走线/渐变也用它 */
    color?: string
    height?: number
    loading?: boolean
  }>(),
  { kind: 'area', color: 'var(--chart-1)', height: 220, format: (v: number) => String(v) },
)

const W = 1000
const PAD_T = 12
const PAD_B = 26
const PAD_L = 4
const PAD_R = 4

const inner = computed(() => ({
  w: W - PAD_L - PAD_R,
  h: props.height - PAD_T - PAD_B,
}))

const max = computed(() => {
  const m = Math.max(...props.points.map((p) => p.v), 0)
  return m > 0 ? m : 1
})

/** 每个点的屏幕坐标 */
const coords = computed(() => {
  const n = props.points.length
  if (!n) return []
  const { w, h } = inner.value
  return props.points.map((p, i) => ({
    ...p,
    x: n === 1 ? PAD_L + w / 2 : PAD_L + (i / (n - 1)) * w,
    y: PAD_T + h - (p.v / max.value) * h,
  }))
})

const linePath = computed(() =>
  coords.value.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' '),
)

const areaPath = computed(() => {
  const cs = coords.value
  if (!cs.length) return ''
  const base = PAD_T + inner.value.h
  return `${linePath.value} L${cs[cs.length - 1]!.x.toFixed(2)},${base} L${cs[0]!.x.toFixed(2)},${base} Z`
})

/** 柱宽：留 30% 间距，单柱时给个合理上限免得变成一整块 */
const barWidth = computed(() => {
  const n = props.points.length
  if (!n) return 0
  return Math.min(inner.value.w / n * 0.7, 48)
})

/** 三条横向参考线（0 / 50% / 100%），只做视觉标尺不标数值 */
const gridLines = computed(() =>
  [0, 0.5, 1].map((r) => PAD_T + inner.value.h * r),
)

/** X 轴稀疏标签：最多 6 个，避免挤成一坨 */
const xLabels = computed(() => {
  const cs = coords.value
  if (cs.length <= 1) return cs.map((c) => ({ x: c.x, label: c.label }))
  const step = Math.max(1, Math.ceil(cs.length / 6))
  const out: { x: number; label: string }[] = []
  for (let i = 0; i < cs.length; i += step) out.push({ x: cs[i]!.x, label: cs[i]!.label })
  return out
})

const hover = ref<number | null>(null)
const hoverPoint = computed(() =>
  hover.value == null ? null : (coords.value[hover.value] ?? null),
)

/** tooltip 贴边时会溢出，靠这个把它推回来 */
const tipAnchor = computed(() => {
  const p = hoverPoint.value
  if (!p) return 'middle'
  if (p.x < 120) return 'start'
  if (p.x > W - 120) return 'end'
  return 'middle'
})

const uid = `ac-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="relative w-full" :style="{ height: `${height}px` }">
    <div
      v-if="loading"
      class="absolute inset-0 animate-pulse rounded-lg bg-bg-inset"
      aria-hidden="true"
    />

    <div
      v-else-if="!points.length"
      class="flex h-full items-center justify-center rounded-lg border border-dashed border-border"
    >
      <p class="text-[12.5px] text-fg-subtle">
        <slot name="empty">暂无数据</slot>
      </p>
    </div>

    <svg
      v-else
      :viewBox="`0 0 ${W} ${height}`"
      preserveAspectRatio="none"
      class="h-full w-full overflow-visible"
      role="img"
      @mouseleave="hover = null"
    >
      <defs>
        <linearGradient :id="`${uid}-fill`" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="props.color" stop-opacity="0.28" />
          <stop offset="100%" :stop-color="props.color" stop-opacity="0.02" />
        </linearGradient>
      </defs>

      <!-- 参考线 -->
      <line
        v-for="(y, i) in gridLines"
        :key="`g-${i}`"
        :x1="PAD_L"
        :x2="W - PAD_R"
        :y1="y"
        :y2="y"
        stroke="var(--color-border)"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />

      <!-- 面积模式 -->
      <template v-if="kind === 'area'">
        <path :d="areaPath" :fill="`url(#${uid}-fill)`" />
        <path
          :d="linePath"
          fill="none"
          :stroke="props.color"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </template>

      <!-- 柱状模式 -->
      <template v-else>
        <rect
          v-for="(c, i) in coords"
          :key="`b-${i}`"
          :x="c.x - barWidth / 2"
          :y="c.y"
          :width="barWidth"
          :height="Math.max(PAD_T + inner.h - c.y, 1)"
          rx="2"
          :fill="props.color"
          :opacity="hover === null || hover === i ? 0.9 : 0.45"
        />
      </template>

      <!-- 悬停指示 -->
      <template v-if="hoverPoint">
        <line
          :x1="hoverPoint.x"
          :x2="hoverPoint.x"
          :y1="PAD_T"
          :y2="PAD_T + inner.h"
          stroke="var(--color-border-strong)"
          stroke-width="1"
          stroke-dasharray="3 3"
          vector-effect="non-scaling-stroke"
        />
        <circle
          v-if="kind === 'area'"
          :cx="hoverPoint.x"
          :cy="hoverPoint.y"
          r="4"
          fill="var(--color-bg-elevated)"
          :stroke="props.color"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
        />
      </template>

      <!-- X 轴标签 -->
      <text
        v-for="(l, i) in xLabels"
        :key="`x-${i}`"
        :x="l.x"
        :y="height - 8"
        text-anchor="middle"
        fill="var(--color-fg-subtle)"
        style="font-size: 11px"
      >
        {{ l.label }}
      </text>

      <!-- 命中区：透明矩形，比让用户去点细线可靠得多 -->
      <rect
        v-for="(c, i) in coords"
        :key="`h-${i}`"
        :x="coords.length === 1 ? PAD_L : c.x - inner.w / coords.length / 2"
        :y="PAD_T"
        :width="coords.length === 1 ? inner.w : inner.w / coords.length"
        :height="inner.h"
        fill="transparent"
        @mouseenter="hover = i"
      />
    </svg>

    <!-- tooltip 用 HTML 而非 SVG text：preserveAspectRatio=none 会把字压变形 -->
    <div
      v-if="hoverPoint && !loading"
      class="pointer-events-none absolute z-10 -translate-y-full rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 shadow-md"
      :style="{
        left: `${(hoverPoint.x / W) * 100}%`,
        top: `${Math.max(hoverPoint.y - 8, 8)}px`,
        transform:
          tipAnchor === 'middle'
            ? 'translate(-50%, -100%)'
            : tipAnchor === 'start'
              ? 'translate(0, -100%)'
              : 'translate(-100%, -100%)',
      }"
    >
      <p class="whitespace-nowrap text-[11px] text-fg-subtle">{{ hoverPoint.label }}</p>
      <p class="whitespace-nowrap text-[12.5px] font-semibold tabular">
        {{ format(hoverPoint.v) }}
      </p>
    </div>
  </div>
</template>
