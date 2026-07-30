<script setup lang="ts">
/** 页标题区。右侧 actions 插槽放主操作按钮（如 Add new key） */
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-[20px] font-semibold tracking-tight">{{ title }}</h1>
      <p v-if="description" class="mt-1 text-[13px] text-fg-muted">
        {{ description }}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
