<script setup lang="ts">
/**
 * 品牌图标 —— 后端 icon 字段是 lobehub 图标名（如 "OpenAI.Color"、"Claude.Color"），
 * 与 New API 官方前端同一套约定。映射到 @lobehub/icons-static-png 的 CDN 静态图：
 *   "Claude.Color" -> light/claude-color.png
 *
 * 关键：lobehub 并非每个品牌都有 -color 变体（OpenAI 只有单色版），
 * dark 目录也不保证齐全。所以这里做的是**候选链降级**而不是一击即溃：
 *   dark/claude-color -> dark/claude -> light/claude-color -> light/claude
 * 全部 404 才回落首字母色块 —— 同一厂商绝不会一半有图一半字母。
 *
 * variant:
 *   auto  跟随主题（暗色优先取 dark/ 目录）
 *   light 恒用 light/ 版 —— 放在白色底板上时用（如精选卡的白色圆角块）
 */
import { ref, computed, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useThemeStore } from '@/stores/theme'

const props = withDefaults(
  defineProps<{ icon?: string | null; name: string; variant?: 'auto' | 'light' }>(),
  { icon: null, variant: 'auto' },
)

const { isDark } = storeToRefs(useThemeStore())

const CDN = 'https://unpkg.com/@lobehub/icons-static-png@latest'

/** 候选 URL 链：加载失败逐个后移，试完为止 */
const candidates = computed<string[]>(() => {
  const raw = props.icon?.trim()
  if (!raw) return []
  if (/^https?:\/\//.test(raw)) return [raw]

  const slug = raw.replace(/\s+/g, '').replace(/\./g, '-').toLowerCase()
  const base = slug.replace(/-color$/, '')
  const withColor = `${base}-color`

  const dirs =
    props.variant === 'light' ? ['light'] : isDark.value ? ['dark', 'light'] : ['light']

  const list: string[] = []
  for (const dir of dirs) {
    // 原名优先（带 -color 的先试 -color，不带的先试原名），再试另一种
    const first = slug.endsWith('-color') ? withColor : base
    const second = slug.endsWith('-color') ? base : withColor
    list.push(`${CDN}/${dir}/${first}.png`, `${CDN}/${dir}/${second}.png`)
  }
  return [...new Set(list)]
})

const idx = ref(0)
watch(candidates, () => (idx.value = 0))

const url = computed(() => candidates.value[idx.value] ?? null)

function onError() {
  idx.value++
}

const COLORS = ['#12aee0', '#4854ff', '#16b391', '#8b5cf6', '#f0883e', '#e05c8a']
const bg = computed(() => {
  let h = 0
  for (const c of props.name) h = (h * 31 + c.charCodeAt(0)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
})
const initial = computed(() => (props.name.trim()[0] ?? '?').toUpperCase())
</script>

<template>
  <img
    v-if="url"
    :src="url"
    :alt="name"
    class="size-full object-contain"
    loading="lazy"
    @error="onError"
  />
  <span
    v-else
    class="grid size-full select-none place-items-center font-bold text-white"
    :style="{ background: bg }"
    aria-hidden="true"
  >
    {{ initial }}
  </span>
</template>
