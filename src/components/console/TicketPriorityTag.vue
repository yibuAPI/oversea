<script setup lang="ts">
/**
 * 优先级标签。只有紧急/高才着色 —— 普通与低是多数情况，
 * 全部着色等于没着色，反而让真正要紧的工单沉进噪声里。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TICKET_PRIORITY } from '@/api/tickets'

const props = defineProps<{ priority: string }>()
const { t } = useI18n()

const STYLES: Record<string, string> = {
  [TICKET_PRIORITY.URGENT]: 'text-danger-fg font-medium',
  [TICKET_PRIORITY.HIGH]: 'text-warning-fg font-medium',
  [TICKET_PRIORITY.NORMAL]: 'text-fg-muted',
  [TICKET_PRIORITY.LOW]: 'text-fg-subtle',
}

const cls = computed(() => STYLES[props.priority] ?? 'text-fg-muted')

const label = computed(() => {
  const key = `tickets.priority_${props.priority}`
  const text = t(key)
  return text === key ? props.priority : text
})
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-1 text-[12px]" :class="cls">
    <!-- 紧急额外给一个点，让它在长列表里扫得出来 -->
    <span
      v-if="priority === TICKET_PRIORITY.URGENT"
      class="size-1.5 rounded-full bg-danger-fg"
      aria-hidden="true"
    />
    {{ label }}
  </span>
</template>
