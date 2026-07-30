<script setup lang="ts">
/**
 * 指标卡。infron 的 Usage & Activity 页顶部六连卡就是这个形状：
 *   小号灰标题 → 大号数值 → 可选的副标题/环比
 * loading 时用骨架条占位，避免数字从 0 跳到真值。
 */
import type { Component } from 'vue'

defineProps<{
  label: string
  value: string
  hint?: string
  icon?: Component
  loading?: boolean
  /** 环比等趋势值，正数绿、负数红 */
  delta?: number | null
}>()
</script>

<template>
  <div class="rounded-xl border border-border bg-bg-elevated p-4">
    <div class="flex items-start justify-between gap-2">
      <p class="text-[12.5px] text-fg-muted">{{ label }}</p>
      <component
        :is="icon"
        v-if="icon"
        class="size-4 shrink-0 text-fg-subtle"
        aria-hidden="true"
      />
    </div>

    <div v-if="loading" class="mt-2 h-7 w-24 animate-pulse rounded bg-bg-inset" />
    <p v-else class="mt-1.5 truncate text-[22px] font-semibold leading-tight tabular">
      {{ value }}
    </p>

    <div v-if="!loading && (hint || delta != null)" class="mt-1 flex items-center gap-1.5">
      <span
        v-if="delta != null"
        class="text-[11.5px] font-medium tabular"
        :class="delta >= 0 ? 'text-success-fg' : 'text-danger-fg'"
      >
        {{ delta >= 0 ? '+' : '' }}{{ delta.toFixed(1) }}%
      </span>
      <span v-if="hint" class="truncate text-[11.5px] text-fg-subtle">{{ hint }}</span>
    </div>
  </div>
</template>
