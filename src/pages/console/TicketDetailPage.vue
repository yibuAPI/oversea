<script setup lang="ts">
/**
 * 工单详情（用户侧）。布局取自原型 detail.html：
 * 左侧状态提示条 + 沟通记录 + 回复框，右侧工单信息卡 + 操作记录时间线。
 *
 * 两点与后端行为强相关，改动前请先看 controller/ticket.go：
 *
 *  1. 打开详情就等于「已读」—— GET 接口会顺带清零 unread_for_user。
 *     所以拿到数据后必须让侧栏红点重新取数（invalidate tickets-unread），
 *     否则红点会一直亮着，用户以为还有没看的回复。
 *  2. 回复会推进状态：待确认 / 已解决 → 处理中。这个跳转由服务端决定，
 *     前端不预测，直接用响应里回来的 ticket 覆盖本地缓存。
 *
 * 内部备注不在这里做过滤：用户侧接口根本不下发 author_type='note' 的消息。
 * 前端再过滤一遍只会掩盖服务端的问题，真漏了也看不出来。
 */
import { computed, ref, nextTick, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  ArrowLeft,
  Paperclip,
  Clock,
  CheckCircle2,
  Info,
  Lock,
  MessageSquare,
} from 'lucide-vue-next'
import {
  getMyTicket,
  replyMyTicket,
  closeMyTicket,
  parseAttachments,
  isTicketLocked,
  TICKET_STATUS,
  TICKET_AUTHOR,
  TICKET_CATEGORIES,
  type TicketMessage,
} from '@/api/tickets'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import TicketStatusPill from '@/components/console/TicketStatusPill.vue'
import TicketPriorityTag from '@/components/console/TicketPriorityTag.vue'
import { formatDateTime, formatRelative } from '@/lib/format'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const qc = useQueryClient()

const ticketId = computed(() => Number(route.params.id))

const detailQ = useQuery({
  queryKey: computed(() => ['ticket', ticketId.value]),
  queryFn: () => getMyTicket(ticketId.value),
  enabled: computed(() => Number.isInteger(ticketId.value) && ticketId.value > 0),
})

const ticket = computed(() => detailQ.data.value?.ticket ?? null)
const messages = computed<TicketMessage[]>(() => detailQ.data.value?.messages ?? [])
const events = computed(() => detailQ.data.value?.events ?? [])
const locked = computed(() => (ticket.value ? isTicketLocked(ticket.value.status) : false))

// 详情接口已在服务端清零未读，让侧栏红点跟着更新
watch(
  () => detailQ.data.value,
  (d) => {
    if (d) qc.invalidateQueries({ queryKey: ['tickets-unread'] })
  },
)

/** 状态提示条：一句话说清「现在球在谁那边」 */
const notice = computed(() => {
  if (!ticket.value) return null
  switch (ticket.value.status) {
    case TICKET_STATUS.PENDING:
      return { icon: Clock, text: t('tickets.pendingNotice'), cls: 'border-border bg-bg-subtle text-fg-muted' }
    case TICKET_STATUS.AWAITING:
      return { icon: Info, text: t('tickets.awaitingNotice'), cls: 'border-warning-border bg-warning-bg text-warning-fg' }
    case TICKET_STATUS.RESOLVED:
      return { icon: CheckCircle2, text: t('tickets.resolvedNotice'), cls: 'border-success-border bg-success-bg text-success-fg' }
    case TICKET_STATUS.CLOSED:
      return { icon: Lock, text: t('tickets.lockedNotice'), cls: 'border-border bg-bg-subtle text-fg-subtle' }
    default:
      return null
  }
})

function categoryLabel(value: string) {
  if (!value) return '—'
  return (TICKET_CATEGORIES as readonly string[]).includes(value)
    ? t(`tickets.category_${value}`)
    : value
}

/** 消息气泡：用户自己的靠右，客服/系统靠左 */
function isMine(m: TicketMessage) {
  return m.author_type === TICKET_AUTHOR.USER
}

/* ---------- 回复 ---------- */

const draft = ref('')
const threadEnd = ref<HTMLElement | null>(null)

async function scrollToEnd() {
  await nextTick()
  threadEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

const replyM = useMutation({
  mutationFn: () => replyMyTicket(ticketId.value, { content: draft.value.trim() }),
  onSuccess: (res) => {
    draft.value = ''
    toast.success(t('tickets.sentOk'))
    // 服务端可能顺带改了状态，用返回的 ticket 覆盖缓存而不是自己猜
    qc.setQueryData(['ticket', ticketId.value], (old: typeof detailQ.data.value) =>
      old
        ? { ...old, ticket: res.ticket, messages: [...(old.messages ?? []), res.message] }
        : old,
    )
    // 事件时间线（如「重新开启」）只能靠重取
    detailQ.refetch()
    qc.invalidateQueries({ queryKey: ['tickets'] })
    scrollToEnd()
  },
  onError: (e: Error) => toast.error(e.message),
})

function submitReply() {
  if (!draft.value.trim()) {
    toast.error(t('tickets.errReplyEmpty'))
    return
  }
  replyM.mutate()
}

/** Cmd/Ctrl + Enter 发送，与原型一致；单独 Enter 留给换行 */
function onDraftKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    submitReply()
  }
}

/* ---------- 关闭工单 ---------- */

const showClose = ref(false)

const closeM = useMutation({
  mutationFn: () => closeMyTicket(ticketId.value),
  onSuccess: () => {
    showClose.value = false
    toast.success(t('tickets.closedOk'))
    detailQ.refetch()
    qc.invalidateQueries({ queryKey: ['tickets'] })
    qc.invalidateQueries({ queryKey: ['tickets-unread'] })
  },
  onError: (e: Error) => toast.error(e.message),
})
</script>

<template>
  <div>
    <PageHeader :title="ticket?.title || t('tickets.detailTitle')">
      <template #actions>
        <AppButton size="sm" @click="router.push({ name: 'console-tickets' })">
          <ArrowLeft class="size-3.5" />
          {{ t('tickets.backToList') }}
        </AppButton>
        <AppButton v-if="ticket && !locked" variant="danger" size="sm" @click="showClose = true">
          {{ t('tickets.close') }}
        </AppButton>
      </template>
    </PageHeader>

    <!-- 加载 / 错误 -->
    <div v-if="detailQ.isLoading.value" class="space-y-3">
      <div class="h-20 animate-pulse rounded-xl bg-bg-muted" />
      <div class="h-40 animate-pulse rounded-xl bg-bg-muted" />
    </div>

    <div
      v-else-if="detailQ.error.value"
      class="rounded-xl border border-danger-border bg-danger-bg px-4 py-6 text-center"
    >
      <p class="text-[13px] text-danger-fg">
        {{ detailQ.error.value.message || t('tickets.notFound') }}
      </p>
      <AppButton class="mt-3" size="sm" @click="detailQ.refetch()">
        {{ t('common.retry') }}
      </AppButton>
    </div>

    <div v-else-if="ticket" class="grid gap-5 lg:grid-cols-[1fr_280px]">
      <!-- 左栏：提示条 + 沟通记录 + 回复框 -->
      <div class="min-w-0 space-y-4">
        <div
          v-if="notice"
          class="flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[12.5px]"
          :class="notice.cls"
        >
          <component :is="notice.icon" class="mt-px size-4 shrink-0" />
          <p>{{ notice.text }}</p>
        </div>

        <section class="rounded-xl border border-border bg-bg-elevated">
          <header class="flex items-center gap-2 border-b border-border px-4 py-3">
            <MessageSquare class="size-3.5 text-fg-subtle" />
            <h2 class="text-[13px] font-semibold">{{ t('tickets.conversation') }}</h2>
            <span class="text-[11.5px] text-fg-subtle">
              {{ t('common.total', { n: messages.length }) }}
            </span>
          </header>

          <div class="space-y-4 px-4 py-4">
            <article
              v-for="m in messages"
              :key="m.id"
              class="flex flex-col gap-1"
              :class="isMine(m) ? 'items-end' : 'items-start'"
            >
              <div class="flex items-center gap-2 text-[11.5px] text-fg-subtle">
                <span class="font-medium text-fg-muted">{{ m.author_name || '—' }}</span>
                <span v-if="m.author_role">{{ m.author_role }}</span>
                <span :title="formatDateTime(m.created_at)">
                  {{ formatRelative(m.created_at) }}
                </span>
              </div>

              <div
                class="max-w-[85%] rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed"
                :class="
                  isMine(m)
                    ? 'border-accent-border bg-accent-bg'
                    : 'border-border bg-bg-subtle'
                "
              >
                <!-- 纯文本渲染。工单内容不过 markdown：用户常粘贴报错和 JSON，
                     按 markdown 解析会把它们的格式吃掉，还多一层 XSS 面 -->
                <p class="whitespace-pre-wrap break-words">{{ m.content }}</p>

                <ul
                  v-if="parseAttachments(m.attachments).length"
                  class="mt-2 space-y-1 border-t border-border pt-2"
                >
                  <li
                    v-for="(name, i) in parseAttachments(m.attachments)"
                    :key="`${m.id}-${i}`"
                    class="flex items-center gap-1.5 text-[11.5px] text-fg-muted"
                  >
                    <Paperclip class="size-3 shrink-0 text-fg-subtle" />
                    <span class="truncate">{{ name }}</span>
                  </li>
                </ul>
              </div>
            </article>
            <div ref="threadEnd" />
          </div>

          <!-- 回复框。已关闭时整块换成提示，不给一个点了没反应的按钮 -->
          <footer class="border-t border-border px-4 py-3">
            <template v-if="locked">
              <p class="flex items-center gap-1.5 text-[12.5px] text-fg-subtle">
                <Lock class="size-3.5" />
                {{ t('tickets.lockedNotice') }}
              </p>
            </template>
            <template v-else>
              <textarea
                v-model="draft"
                rows="3"
                maxlength="5000"
                :placeholder="t('tickets.replyPlaceholder')"
                class="w-full resize-y rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] outline-none focus:border-border-selected"
                @keydown="onDraftKeydown"
              />
              <div class="mt-2 flex items-center justify-between gap-2">
                <span class="text-[11.5px] text-fg-subtle">{{ t('tickets.replyHint') }}</span>
                <AppButton
                  variant="primary"
                  size="sm"
                  :loading="replyM.isPending.value"
                  :disabled="!draft.trim()"
                  @click="submitReply"
                >
                  {{ t('tickets.send') }}
                </AppButton>
              </div>
            </template>
          </footer>
        </section>
      </div>

      <!-- 右栏：信息卡 + 操作记录 -->
      <aside class="space-y-4">
        <section class="rounded-xl border border-border bg-bg-elevated px-4 py-3.5">
          <h2 class="mb-3 text-[13px] font-semibold">{{ t('tickets.infoCard') }}</h2>
          <dl class="space-y-2 text-[12.5px]">
            <div class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.infoId') }}</dt>
              <dd class="font-mono">#{{ ticket.id }}</dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.colStatus') }}</dt>
              <dd><TicketStatusPill :status="ticket.status" /></dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.colPriority') }}</dt>
              <dd><TicketPriorityTag :priority="ticket.priority" /></dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.colCategory') }}</dt>
              <dd>{{ categoryLabel(ticket.category || ticket.type) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.colAssignee') }}</dt>
              <dd>{{ ticket.assignee_name || t('tickets.unassigned') }}</dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.infoCreated') }}</dt>
              <dd>{{ formatDateTime(ticket.created_at) }}</dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.infoUpdated') }}</dt>
              <dd>{{ formatDateTime(ticket.updated_at || ticket.created_at) }}</dd>
            </div>
            <!-- 未解决 / 未关闭时后端给 0，此时整行不显示 -->
            <div v-if="ticket.resolved_at" class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.infoResolved') }}</dt>
              <dd>{{ formatDateTime(ticket.resolved_at) }}</dd>
            </div>
            <div v-if="ticket.closed_at" class="flex items-center justify-between gap-2">
              <dt class="text-fg-subtle">{{ t('tickets.infoClosed') }}</dt>
              <dd>{{ formatDateTime(ticket.closed_at) }}</dd>
            </div>
          </dl>
        </section>

        <section class="rounded-xl border border-border bg-bg-elevated px-4 py-3.5">
          <h2 class="mb-3 text-[13px] font-semibold">{{ t('tickets.timeline') }}</h2>
          <p v-if="!events.length" class="text-[12px] text-fg-subtle">
            {{ t('tickets.timelineEmpty') }}
          </p>
          <ol v-else class="space-y-3">
            <li v-for="ev in events" :key="ev.id" class="relative pl-4">
              <span
                class="absolute left-0 top-1.5 size-1.5 rounded-full bg-border-strong"
                aria-hidden="true"
              />
              <!-- text 是后端预渲染的整句，前端不再拼装 -->
              <p class="text-[12.5px] leading-snug">
                <span v-if="ev.actor_name" class="font-medium">{{ ev.actor_name }}</span>
                {{ ev.text }}
              </p>
              <p class="mt-0.5 text-[11px] text-fg-subtle" :title="formatDateTime(ev.created_at)">
                {{ formatRelative(ev.created_at) }}
              </p>
            </li>
          </ol>
        </section>
      </aside>
    </div>

    <AppModal
      :open="showClose"
      :title="t('tickets.closeConfirmTitle')"
      :description="t('tickets.closeConfirmDesc')"
      @close="showClose = false"
    >
      <template #footer>
        <AppButton size="sm" @click="showClose = false">{{ t('common.cancel') }}</AppButton>
        <AppButton
          variant="danger"
          size="sm"
          :loading="closeM.isPending.value"
          @click="closeM.mutate()"
        >
          {{ t('tickets.close') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
