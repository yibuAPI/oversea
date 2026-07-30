<script setup lang="ts">
/**
 * 打字机标题 —— 逐字蹦出 + 品牌渐变 + 打完后闪烁光标 `_`。
 *
 * 渐变实现（踩过两个坑，记下来）：
 *   坑 1  把 `background-clip: text` 放外层、字符用 inline-block 做 transform：
 *         渐变完全失效。inline-block 子元素各自成盒，父级的 text-clip
 *         背景不铺到它们身上，黑底上直接整行看不见。
 *   坑 2  改用 mask + mix-blend-mode 挖字形：blend 在黑底上把渐变压成黑，
 *         同样看不见。
 *   最终  每个字符自带 background-clip: text，颜色按它在整串里的位置
 *         从品牌三色（紫 → 天蓝 → 薄荷）插值取一个纯色。
 *         视觉上整行仍是完整渐变，但每个字是独立盒，
 *         transform / opacity 动画随便做，且渐变坐标不随行宽变化 ——
 *         已经出现的字不会因为后面又蹦出一个字而改色。
 *
 * 每个字的入场时机用 animation-delay 排，纯 CSS 驱动，不占主线程。
 * 光标 delay = 起始延迟 + 全部字符打完的时间，在此之前 opacity 为 0。
 *
 * 无障碍：动画层整体 aria-hidden，另给一份 sr-only 完整文本，
 * 否则读屏会把标题读成一个个孤立字母。
 * prefers-reduced-motion 下全部直接显示、光标常亮不闪。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    text: string
    /** 每字间隔 ms */
    speed?: number
    /** 整体起始延迟 ms */
    delay?: number
    /** 打完后是否显示闪烁光标 */
    cursor?: boolean
  }>(),
  { speed: 65, delay: 250, cursor: true },
)

/** 品牌渐变的三个锚点，与 tokens.css 的 --brand-gradient 同源 */
const STOPS: [number, [number, number, number]][] = [
  [0, [72, 84, 255]], // #4854ff 蓝紫
  [0.55, [59, 202, 245]], // #3bcaf5 天蓝
  [1, [134, 239, 215]], // #86efd7 薄荷
]

/** 在 STOPS 上线性插值，t ∈ [0,1] */
function sample(t: number): string {
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i - 1]!
    const [p2, c2] = STOPS[i]!
    if (t > p2 && i < STOPS.length - 1) continue
    const k = p2 === p1 ? 0 : (t - p1) / (p2 - p1)
    const mix = c1.map((v, j) => Math.round(v + (c2[j]! - v) * k))
    return `rgb(${mix.join(',')})`
  }
  return `rgb(${STOPS[0]![1].join(',')})`
}

/** 用展开而不是 split('')，避免把非 BMP 字符劈成两半 */
const chars = computed(() =>
  [...props.text].map((c, i, arr) => ({
    c,
    // 单字时避免除以 0，直接取渐变起点
    color: sample(arr.length > 1 ? i / (arr.length - 1) : 0),
  })),
)
const cursorDelay = computed(
  () => props.delay + chars.value.length * props.speed,
)
</script>

<template>
  <span class="tw">
    <span class="sr-only">{{ text }}</span>

    <span aria-hidden="true" class="tw-body">
      <span
        v-for="(ch, i) in chars"
        :key="`${i}-${ch.c}`"
        class="tw-char"
        :style="{
          animationDelay: `${delay + i * speed}ms`,
          color: ch.color,
        }"
        >{{ ch.c }}</span
      >
      <span
        v-if="cursor"
        class="tw-caret"
        :style="{ animationDelay: `${cursorDelay}ms` }"
        >_</span
      >
    </span>
  </span>
</template>

<style scoped>
.tw-body {
  /* 标题不折行，否则光标会单独掉到下一行 */
  white-space: nowrap;
}

.tw-char {
  display: inline-block;
  /* 保住空格宽度：inline-block 里的裸空格会被折叠掉 */
  white-space: pre;
  opacity: 0;
  animation: tw-in 260ms cubic-bezier(0.2, 1.4, 0.4, 1) forwards;
}

.tw-caret {
  display: inline-block;
  white-space: pre;
  /* 光标取渐变末端色，接在最后一个字后面不突兀 */
  color: #86efd7;
  opacity: 0;
  animation: tw-caret 1s step-end infinite;
}

@keyframes tw-in {
  from {
    opacity: 0;
    transform: translateY(0.16em) scale(0.9);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes tw-caret {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tw-char {
    opacity: 1;
    animation: none;
  }
  .tw-caret {
    opacity: 1;
    /* 闪烁对部分用户不友好，减弱动效时直接常亮 */
    animation: none;
  }
}
</style>
