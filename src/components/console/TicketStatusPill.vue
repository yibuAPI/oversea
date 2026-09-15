<script setup lang="ts">
/**
 * 工单状态胶囊。列表与详情共用，保证同一状态在任何位置是同一个颜色。
 *
 * 配色对应状态机语义，不是随便挑的：
 *   pending    等待接单 —— 中性灰，还没人动
 *   processing 正在处理 —— info 蓝，进行中
 *   awaiting   等用户确认 —— warning 黄，球在用户这边
 *   resolved   已解决 —— success 绿
 *   closed     已关闭 —— 最淡，归档态
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TICKET_STATUS } from '@/api/tickets'

const props = defineProps<{ status: string }>()
const { t } = useI18n()

const STYLES: Record<string, string> = {
  [TICKET_STATUS.PENDING]: 'border-border bg-bg-muted text-fg-muted',
  [TICKET_STATUS.PROCESSING]: 'border-info-border bg-info-bg text-info-fg',
  [TICKET_STATUS.AWAITING]: 'border-warning-border bg-warning-bg text-warning-fg',
  [TICKET_STATUS.RESOLVED]: 'border-success-border bg-success-bg text-success-fg',
  [TICKET_STATUS.CLOSED]: 'border-border bg-bg-subtle text-fg-subtle',
}

const cls = computed(
  () => STYLES[props.status] ?? 'border-border bg-bg-muted text-fg-muted',
)

/** 未知状态原样显示，不吞掉信息 —— 后端加了新状态时页面仍可读 */
const label = computed(() => {
  const key = `tickets.status_${props.status}`
  const text = t(key)
  return text === key ? props.status : text
})
</script>

<template>
  <span
    class="inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium"
    :class="cls"
  >
    {{ label }}
  </span>
</template>
