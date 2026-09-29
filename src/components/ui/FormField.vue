<script setup lang="ts">
/**
 * 表单字段包装：label + 控件 + 提示/错误。
 * label 通过 :for 绑到控件 id —— 点标签能聚焦控件，这是无障碍基本要求。
 *
 * labelExtra 插槽：给标签行右侧挂点附属内容（如「用户ID：1 + 复制」）。
 * 刻意放在 <label> 外面而不是里面 —— 按钮套在 label 里，点它会连带触发
 * 标签的激活行为（转发点击给 :for 指向的控件），复制一下就顺手改了值。
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
    <div class="mb-1.5 flex items-center gap-2">
      <label :for="id" class="text-[12.5px] font-medium">
        {{ label }}
        <span v-if="required" class="text-danger-fg" aria-hidden="true">*</span>
      </label>
      <slot name="labelExtra" />
    </div>
    <slot />
    <p v-if="error" class="mt-1 text-[11.5px] text-danger-fg">{{ error }}</p>
    <p v-else-if="hint" class="mt-1 text-[11.5px] text-fg-subtle">{{ hint }}</p>
  </div>
</template>
