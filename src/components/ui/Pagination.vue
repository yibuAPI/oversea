<script setup lang="ts">
/**
 * 分页。后端 PageInfo 给的是 { page, page_size, total }，
 * 页数需前端算。总数为 0 时整个组件不渲染。
 *
 * 可选开启「每页条数」下拉（pageSizeOptions 传入即开启，如 [10, 20, 50, 100]），
 * 开启后会把当前页当成「第 1 页」重置，通过 update:pageSize 通知父级。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
  /** 传入即渲染「每页条数」下拉（可选 10/20/50/100），默认不渲染，兼容现有调用方 */
  pageSizeOptions?: number[]
}>()
const emit = defineEmits<{
  'update:page': [number]
  'update:pageSize': [number]
}>()

const { t } = useI18n()

const options = computed(() => props.pageSizeOptions ?? [])
const showPageSize = computed(() => options.value.length > 0)

const pageCount = computed(() =>
  props.pageSize > 0 ? Math.max(1, Math.ceil(props.total / props.pageSize)) : 1,
)
const from = computed(() => (props.page - 1) * props.pageSize + 1)
const to = computed(() => Math.min(props.page * props.pageSize, props.total))

/** 改每页条数后页数会变，统一回到第 1 页（配合父组件把当前页重置为 1） */
function onPageSizeChange(e: Event) {
  const v = Number((e.target as HTMLSelectElement).value)
  if (v !== props.pageSize) emit('update:pageSize', v)
}
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
        class="motion-press flex size-8 items-center justify-center rounded-md border border-border hover:bg-bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="page <= 1"
        :aria-label="t('common.prevPage')"
        @click="emit('update:page', page - 1)"
      >
        <ChevronLeft class="size-4" />
      </button>
      <span class="px-2 tabular">{{ page }} / {{ pageCount }}</span>
      <button
        type="button"
        class="motion-press flex size-8 items-center justify-center rounded-md border border-border hover:bg-bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
        :disabled="page >= pageCount"
        :aria-label="t('common.nextPage')"
        @click="emit('update:page', page + 1)"
      >
        <ChevronRight class="size-4" />
      </button>
      <label
        v-if="showPageSize"
        class="ml-1 flex items-center gap-1 text-[12.5px] text-fg-muted"
      >
        <span>{{ t('common.perPage') }}</span>
        <select
          :value="pageSize"
          class="motion-press h-8 appearance-none rounded-md border border-border bg-bg-elevated pl-2 pr-7 text-[12.5px] font-medium text-fg-muted outline-none"
          :aria-label="t('common.perPage')"
          @change="onPageSizeChange"
        >
          <option v-for="n in options" :key="n" :value="n" class="bg-bg-elevated">
            {{ n }}
          </option>
        </select>
      </label>
    </div>
  </div>
</template>
