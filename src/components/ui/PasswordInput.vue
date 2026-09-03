<script setup lang="ts">
/**
 * 带「显示密码」眼睛开关的密码输入框。
 * 只负责输入 + 切换可见性；id/autocomplete/placeholder/required 等透传给 <input>。
 *
 * 两种皮肤（variant）：
 *   - console：控制台 token 主题（亮/暗跟随全站），对应 Settings / Budgets 的 INPUT 常量
 *   - dark   ：登录/注册页硬编码深色（不消费全站 token），对应 Register 的 INPUT_CLASS
 * 眼睛按钮的配色与右内边距随皮肤走，其余行为完全一致。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff } from 'lucide-vue-next'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: string
    variant?: 'console' | 'dark'
  }>(),
  { variant: 'console' },
)
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const { t } = useI18n()

const show = ref(false)

const INPUT = {
  console:
    'h-9 w-full rounded-lg border border-border bg-bg px-3 pr-9 text-[13px] outline-none transition-colors focus:border-border-selected',
  dark:
    'h-10 w-full rounded-[6px] border border-[#2e2e2e] bg-transparent px-3 pr-10 text-[14px] text-[#f2f2f2] outline-none transition-colors placeholder:text-[#6b6b6b] focus:border-[#5a5a5a]',
}[props.variant]

const BUTTON = {
  console: 'w-9 rounded-r-lg text-fg-subtle hover:bg-bg-muted hover:text-fg',
  dark: 'w-10 rounded-r-[6px] text-[#6b6b6b] hover:bg-white/5 hover:text-[#f2f2f2]',
}[props.variant]

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="relative">
    <input
      v-bind="$attrs"
      :type="show ? 'text' : 'password'"
      :value="modelValue"
      :class="INPUT"
      @input="onInput"
    />
    <button
      type="button"
      :class="BUTTON"
      class="absolute inset-y-0 right-0 flex items-center justify-center transition-colors"
      :aria-label="show ? t('common.hidePassword') : t('common.showPassword')"
      @click="show = !show"
    >
      <EyeOff v-if="show" class="size-4" />
      <Eye v-else class="size-4" />
    </button>
  </div>
</template>
