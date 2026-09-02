<script setup lang="ts">
/**
 * 按钮。控制台里到处都是，统一在这里定尺寸与状态，
 * 避免每个页面各写一套 class 导致高度差 1px 的那种廉价感。
 */
import { computed } from 'vue'
import { Loader2 } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
)

const cls = computed(() => {
  const base =
    'motion-press inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
  const size =
    props.size === 'sm' ? 'h-8 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-[13px]'
  const variant = {
    /* infron 控制台的主按钮是深色底（暗色主题下为白底黑字），不是品牌蓝 */
    primary:
      'bg-btn-primary-bg text-btn-primary-fg hover:bg-btn-primary-hover hover:-translate-y-px',
    secondary: 'border border-border bg-bg text-fg hover:bg-bg-muted',
    ghost: 'text-fg-muted hover:bg-bg-muted hover:text-fg',
    danger: 'border border-danger-border bg-danger-bg text-danger-fg hover:bg-danger-bg/70',
  }[props.variant]
  return [base, size, variant].join(' ')
})
</script>

<template>
  <button :type="type" :class="cls" :disabled="disabled || loading">
    <Loader2 v-if="loading" class="size-3.5 shrink-0 animate-spin" />
    <slot />
  </button>
</template>
