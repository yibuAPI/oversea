<script setup lang="ts">
/**
 * 药丸 toggle 开关。用于「跨分组重试」这类布尔开关。
 *
 * 用 <button> 而非 <input type=checkbox>，是为了完全控制轨道/圆钮的视觉。
 * 代价是无障碍要自己补齐：role=switch + aria-checked，button 本身已可
 * Tab 聚焦、Space/Enter 触发。
 *
 * 注意 type="button" 是必须的 —— 这个组件会用在 <form> 里，
 * 默认的 type=submit 会让按空格切换开关顺带提交整个表单。
 */
const model = defineModel<boolean>({ required: true })

defineProps<{
  disabled?: boolean
  /** 无可见文字标签时用它做 aria-label */
  label?: string
}>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    class="motion-press relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
    :class="model ? 'bg-[var(--color-btn-primary-bg)]' : 'bg-bg-inset'"
    @click="model = !model"
  >
    <span
      class="pointer-events-none inline-block size-4 rounded-full shadow-sm transition-transform"
      :class="
        model
          ? 'translate-x-[18px] bg-[var(--color-btn-primary-fg)]'
          : 'translate-x-0.5 bg-white'
      "
    />
  </button>
</template>
