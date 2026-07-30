<script setup lang="ts">
/**
 * 表单字段包装：label + 控件 + 提示/错误。
 * label 通过 :for 绑到控件 id —— 点标签能聚焦控件，这是无障碍基本要求。
 */
defineProps<{
  id: string
  label: string
  hint?: string
  error?: string | null
  required?: boolean
}>()
</script>

<template>
  <div>
    <label :for="id" class="mb-1.5 block text-[12.5px] font-medium">
      {{ label }}
      <span v-if="required" class="text-danger-fg" aria-hidden="true">*</span>
    </label>
    <slot />
    <p v-if="error" class="mt-1 text-[11.5px] text-danger-fg">{{ error }}</p>
    <p v-else-if="hint" class="mt-1 text-[11.5px] text-fg-subtle">{{ hint }}</p>
  </div>
</template>
