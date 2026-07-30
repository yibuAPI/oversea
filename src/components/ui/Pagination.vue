<script setup lang="ts">
/**
 * 分页。后端 PageInfo 给的是 { page, page_size, total }，
 * 页数需前端算。总数为 0 时整个组件不渲染。
 */
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
}>()
const emit = defineEmits<{ 'update:page': [number] }>()

const pageCount = computed(() =>
  props.pageSize > 0 ? Math.max(1, Math.ceil(props.total / props.pageSize)) : 1,
)
const from = computed(() => (props.page - 1) * props.pageSize + 1)
const to = computed(() => Math.min(props.page * props.pageSize, props.total))
</script>

<template>
  <div
    v-if="total > 0"
    class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-fg-muted"
  >
    <p class="tabular">{{ from }}–{{ to }} / {{ total }}</p>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-md border border-border transition-colors hover:bg-bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="page <= 1"
        aria-label="上一页"
        @click="emit('update:page', page - 1)"
      >
        <ChevronLeft class="size-4" />
      </button>
      <span class="px-2 tabular">{{ page }} / {{ pageCount }}</span>
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-md border border-border transition-colors hover:bg-bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="page >= pageCount"
        aria-label="下一页"
        @click="emit('update:page', page + 1)"
      >
        <ChevronRight class="size-4" />
      </button>
    </div>
  </div>
</template>
