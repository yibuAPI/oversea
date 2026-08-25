<script setup lang="ts" generic="T extends Record<string, any>">
/**
 * 表格。控制台里 API Keys / Logs / Transactions 等页共用。
 *
 * 三种状态必须都覆盖，缺一个用户就会盯着空白页发懵：
 *   loading -> 骨架行（行数与 pageSize 一致，避免高度跳动）
 *   error   -> 错误文案 + 重试
 *   empty   -> 空态插槽
 *
 * 列宽交给调用方通过 col.class 控制，这里不猜。
 */
export interface Column<T> {
  key: string
  label: string
  /** th/td 都会带上，用来控制宽度与对齐 */
  class?: string
  /** 表头是否右对齐（数值列） */
  numeric?: boolean
}

const props = defineProps<{
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  loading?: boolean
  error?: string | null
  skeletonRows?: number
}>()

defineEmits<{ retry: [] }>()

defineSlots<{
  cell(props: { row: T; column: Column<T> }): unknown
  empty(): unknown
}>()
</script>

<template>
  <div class="motion-lift overflow-hidden rounded-xl border border-border bg-bg-elevated hover:shadow-lg">
    <div class="overflow-x-auto">
      <table class="w-full border-collapse text-[13px]">
        <thead>
          <tr class="border-b border-border bg-bg-subtle">
            <th
              v-for="col in props.columns"
              :key="col.key"
              scope="col"
              class="whitespace-nowrap px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-wide text-fg-subtle"
              :class="[col.class, col.numeric ? 'text-right' : 'text-left']"
            >
              {{ col.label }}
            </th>
          </tr>
        </thead>

        <tbody>
          <!-- 加载中 -->
          <template v-if="props.loading">
            <tr
              v-for="i in props.skeletonRows ?? 5"
              :key="`sk-${i}`"
              class="border-b border-border last:border-0"
            >
              <td v-for="col in props.columns" :key="col.key" class="px-4 py-3">
                <div class="h-3.5 animate-pulse rounded bg-bg-inset" />
              </td>
            </tr>
          </template>

          <!-- 出错 -->
          <tr v-else-if="props.error">
            <td :colspan="props.columns.length" class="px-4 py-12 text-center">
              <p class="text-[13px] text-danger-fg">{{ props.error }}</p>
              <button
                type="button"
                class="mt-3 rounded-md border border-border px-3 py-1.5 text-[12.5px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
                @click="$emit('retry')"
              >
                重试
              </button>
            </td>
          </tr>

          <!-- 空 -->
          <tr v-else-if="!props.rows.length">
            <td :colspan="props.columns.length" class="px-4 py-14 text-center">
              <slot name="empty" />
            </td>
          </tr>

          <!-- 数据 -->
          <tr
            v-for="row in props.rows"
            v-else
            :key="props.rowKey(row)"
            class="border-b border-border transition-colors last:border-0 hover:bg-bg-subtle"
          >
            <td
              v-for="col in props.columns"
              :key="col.key"
              class="px-4 py-2.5 align-middle"
              :class="[col.class, col.numeric ? 'text-right tabular' : '']"
            >
              <slot name="cell" :row="row" :column="col">
                {{ row[col.key] }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
