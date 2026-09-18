<script setup lang="ts">
/**
 * 工单详情（用户侧）。布局取自原型 detail.html：
 * 左侧状态提示条 + 沟通记录 + 回复框，右侧工单信息卡。
 *
 * 两点与后端行为强相关，改动前请先看 controller/ticket.go：
 *
 *  1. 打开详情就等于「已读」—— GET 接口会顺带清零 unread_for_user。
 *     所以拿到数据后必须让侧栏红点重新取数（invalidate tickets-unread），
 *     否则红点会一直亮着，用户以为还有没看的回复。
 *  2. 回复会推进状态：待确认 / 已解决 → 处理中。这个跳转由服务端决定，
 *     前端不预测，直接用响应里回来的 ticket 覆盖本地缓存。
 *  3. 客服的回复与状态变更由 WebSocket 主动推来（见 api/ticketSocket.ts），
 *     不再靠轮询。轮询只在连接断开期间兜底。
 *
 * 内部备注不在这里做过滤：用户侧接口根本不下发 author_type='note' 的消息。
 * 前端再过滤一遍只会掩盖服务端的问题，真漏了也看不出来。
 */
import { computed, ref, nextTick, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  ArrowLeft,
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
  isTicketLocked,
  TICKET_STATUS,
  TICKET_AUTHOR,
  TICKET_CATEGORIES,
  type TicketMessage,
} from '@/api/tickets'
import { TicketSocket, type TicketSocketEvent } from '@/api/ticketSocket'
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

/** WS 是否连着。连着就不轮询，断开才退回轮询 —— 见下方 refetchInterval */
const wsConnected = ref(false)

const detailQ = useQuery({
  queryKey: computed(() => ['ticket', ticketId.value]),
  queryFn: () => getMyTicket(ticketId.value),
  enabled: computed(() => Number.isInteger(ticketId.value) && ticketId.value > 0),
  // 客服回复由 WebSocket 推来（api/ticketSocket.ts），所以连着的时候不轮询。
  // 断开期间退回 15 秒轮询兜底：代理掐连接、浏览器禁用 WebSocket 之类的情况下，
  // 页面不能变成一动不动的死页。
  // refetchIntervalInBackground 保持默认 false —— 标签页切到后台自动停表
  refetchInterval: computed(() => (wsConnected.value ? false : 15_000)),
  // 全局默认关了窗口聚焦重取（main.ts），这里显式打开：切回来立刻补一次
  refetchOnWindowFocus: true,
})

const ticket = computed(() => detailQ.data.value?.ticket ?? null)
const messages = computed<TicketMessage[]>(() => detailQ.data.value?.messages ?? [])
const locked = computed(() => (ticket.value ? isTicketLocked(ticket.value.status) : false))

// 详情接口已在服务端清零未读，让侧栏红点跟着更新。
// 注意轮询每 15 秒都会给出一个新对象，无条件 invalidate 会让 /tickets/unread
// 跟着每 15 秒多打一次，所以只在「换了工单或真的来了新消息」时才通知侧栏。
let lastUnreadSyncKey = ''
watch(
  () => detailQ.data.value,
  (d) => {
    if (!d) return
    const key = `${d.ticket.id}:${d.messages?.length ?? 0}`
    if (key === lastUnreadSyncKey) return
    lastUnreadSyncKey = key
    qc.invalidateQueries({ queryKey: ['tickets-unread'] })
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

/**
 * Enter 发送，Shift+Enter 换行，与游乐场、管理端工单一致。
 * isComposing 必须放行：中文候选词也是按 Enter 确认的，拦下来会把半截拼音发出去。
 */
function onDraftKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
  e.preventDefault()
  submitReply()
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

/* ---------- 实时推送 ---------- */

/**
 * 处理一条推送。后端广播是发给房间所有人的（controller 拿不到发送者的那条
 * 连接），所以自己动作的回声也会回到这里，必须按 sender 丢掉 —— 本地的
 * HTTP 响应早把消息写进缓存了，再追加一次就是两条一样的气泡。
 *
 * 内部备注不会到这里：后端走的是只发客服侧的独立广播函数。
 */
function onSocketEvent(ev: TicketSocketEvent) {
  // typing 目前不接界面。留下这个分支是为了让「收到但不展示」显式可见，
  // 而不是让它掉进下面的追加逻辑
  if (ev.type === 'typing') return
  if (ev.sender === TICKET_AUTHOR.USER) return
  // 切换工单的瞬间，旧连接可能还有一条在途
  if (ev.ticket_id && ev.ticket_id !== ticketId.value) return

  qc.setQueryData(['ticket', ticketId.value], (old: typeof detailQ.data.value) => {
    if (!old) return old
    const next = { ...old, ticket: ev.ticket ?? old.ticket }
    const incoming = ev.message
    if (incoming && !(old.messages ?? []).some((m) => m.id === incoming.id)) {
      next.messages = [...(old.messages ?? []), incoming]
    }
    return next
  })

  if (ev.message) scrollToEnd()

  // 重取有两件事非做不可：
  //  1. 用户正看着这条工单，但服务端照样给这条回复 +1 unread_for_user，
  //     只有再走一次详情接口才会清零（清零逻辑在 GET 里）。
  //  2. 事件时间线（改状态、指派各写一条）不在推送里。
  // 清零发生在 refetch 返回之后，所以侧栏红点要等它落地再取 —— 上面那个
  // watch 触发的 invalidate 会赶在清零之前，拿到的是旧值。
  detailQ.refetch().then(() => {
    qc.invalidateQueries({ queryKey: ['tickets-unread'] })
  })
  qc.invalidateQueries({ queryKey: ['tickets'] })
}

let socket: TicketSocket | null = null

function closeSocket() {
  socket?.close()
  socket = null
  wsConnected.value = false
}

// 路由参数变了要换房间：每个连接只订阅一个工单 id。
// immediate 让首次进入也在这里建连，不用再写一遍 onMounted。
watch(
  ticketId,
  (id) => {
    closeSocket()
    if (!Number.isInteger(id) || id <= 0) return
    socket = new TicketSocket(id, {
      onEvent: onSocketEvent,
      // 断线期间漏掉的消息在这里补齐。全量重取而不是增量：详情接口本就一次
      // 拉全部消息和时间线
      onReconnect: () => detailQ.refetch(),
      onStatus: (connected) => (wsConnected.value = connected),
      // 连不上不弹 toast：退避重连每次失败都弹一遍会把界面糊住，
      // 轮询兜底已经保证数据不停
      onError: () => {},
    })
    socket.connect()
  },
  { immediate: true },
)

onUnmounted(closeSocket)
</script>

<template>
  <!--
    lg 以上把页面高度锁在视口内，让「沟通记录」自己滚（见下方 overflow-y-auto）。
    否则消息越攒越多会把整页撑高，回复框被推到文档流底部 —— 每发一条，
    输入框的位置就往下跑一截。
    窄屏不锁：那里是单列堆叠（对话 + 信息卡），锁死高度会把信息卡挤出可视区。
  -->
  <div class="flex flex-col lg:min-h-0 lg:flex-1">
    <PageHeader class="shrink-0" :title="ticket?.title || t('tickets.detailTitle')">
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

    <div
      v-else-if="ticket"
      class="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_360px]"
    >
      <!-- 左栏：提示条 + 沟通记录 + 回复框 -->
      <div class="flex min-w-0 flex-col gap-4 lg:min-h-0">
        <div
          v-if="notice"
          class="flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[12.5px]"
          :class="notice.cls"
        >
          <component :is="notice.icon" class="mt-px size-4 shrink-0" />
          <p>{{ notice.text }}</p>
        </div>

        <section
          class="flex flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated lg:min-h-0 lg:flex-1"
        >
          <header
            class="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5"
          >
            <MessageSquare class="size-3.5 text-fg-subtle" />
            <h2 class="text-[13px] font-semibold">{{ t('tickets.conversation') }}</h2>
            <span class="text-[11.5px] text-fg-subtle">
              {{ t('common.total', { n: messages.length }) }}
            </span>
          </header>

          <!-- 唯一的滚动区：消息在这里滚，上面的标题和下面的回复框不动 -->
          <div class="min-h-[300px] space-y-4 overflow-y-auto px-5 py-5 lg:min-h-0 lg:flex-1">
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
              </div>
            </article>
            <div ref="threadEnd" />
          </div>

          <!-- 回复框。已关闭时整块换成提示，不给一个点了没反应的按钮 -->
          <footer class="shrink-0 border-t border-border px-5 py-4">
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

      <!-- 右栏：信息卡。同样锁在视口内自己滚，字段多时不会顶破布局 -->
      <aside class="space-y-4 lg:min-h-0 lg:overflow-y-auto">
        <!-- 不加 h-full：父级已是滚动容器，撑满只会在字段少时留一大片空白 -->
        <section class="rounded-xl border border-border bg-bg-elevated px-5 py-4">
          <h2 class="mb-4 text-[13px] font-semibold">{{ t('tickets.infoCard') }}</h2>
          <dl class="space-y-3 text-[13px]">
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
