<script setup lang="ts">
/**
 * 带「显示密码」眼睛开关的密码输入框。
 * 只负责输入 + 切换可见性；id/autocomplete/placeholder/required 等透传给 <input>。
 *
 * 两种皮肤（variant）：
 *   - console：控制台密排布局（h-9），对应 Settings / Budgets 的 INPUT 常量
 *   - auth   ：登录/注册页的宽松布局（h-10，更宽的右内边距）
 * 两者都消费全站 token，亮暗主题各自跟随 —— 登录页早期是写死深色的，
 * 那个「dark」皮肤已经删掉，别再加回来。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff } from 'lucide-vue-next'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue: string
    variant?: 'console' | 'auth'
  }>(),
  { variant: 'console' },
)
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const { t } = useI18n()

const show = ref(false)

const INPUT = {
  console:
    'h-9 w-full rounded-lg border border-border bg-bg px-3 pr-9 text-[13px] outline-none transition-colors focus:border-border-selected',
  auth:
    'h-10 w-full rounded-[6px] border border-border bg-transparent px-3 pr-10 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-border-selected',
}[props.variant]

const BUTTON = {
  console: 'w-9 rounded-r-lg text-fg-subtle hover:bg-bg-muted hover:text-fg',
  auth: 'w-10 rounded-r-[6px] text-fg-subtle hover:bg-bg-muted hover:text-fg',
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
