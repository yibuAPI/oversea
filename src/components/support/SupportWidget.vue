<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { MessageCircle } from 'lucide-vue-next'
import BeautifulChat from 'vue3-beautiful-chat'
import type { ChatColors, ChatMessage, ChatParticipant } from 'vue3-beautiful-chat'
import { useSiteStore } from '@/stores/site'
import {
  SupportSocket,
  closeSupportConversation,
  getSupportConversation,
  getSupportMessages,
  sendSupportMessage,
  type SupportConversation,
  type SupportMessage,
  type SupportSocketEvent,
} from '@/api/support'

/**
 * 全站悬浮客服窗。挂在 App.vue 上，只在后端开启 live_support 时渲染。
 *
 * 分工：
 *   - 气泡（launcher）+ 未读红点由本组件自己画，不用库自带的
 *     （showLauncher=false）。库的 launcher 不接受未读徽标，而"客服不在时
 *     用户不知道有回复"是这类组件最容易漏的一环。
 *   - 聊天窗交给 vue3-beautiful-chat。它只是个视图组件，不发消息 ——
 *     所以 onMessageWasSent 里我们走 HTTP POST，拿回真实 id 再入列表。
 *
 * 颜色：库要的是字面量，不能吃 CSS 变量。tokens.css 的规则是"组件只消费
 * var(--color-*)"，所以这里用 getComputedStyle 把变量解析成实际值再喂进去，
 * 深浅色切换时重新解析一遍。写死 #4e8cff 会让客服窗在暗色主题下突兀。
 */
const { t } = useI18n()
const site = useSiteStore()
const { liveSupportEnabled, liveSupportTitle, liveSupportWelcome } =
  storeToRefs(site)

/**
 * 只在公开页面出现。控制台（requiresAuth）里已经有一个消息中心，再挂一个
 * 客服气泡会盖住页面右下角的操作区；登录/注册页（guestOnly）上弹客服也
 * 显得像在挽留用户。
 */
const route = useRoute()
const routeAllowed = computed(
  () => !route.meta.requiresAuth && !route.meta.guestOnly,
)

const isOpen = ref(false)
/** 气泡上的未读红点：关着窗口时收到回复才计数 */
const unread = ref(0)
const loading = ref(false)
const loadError = ref<string | null>(null)
const sendError = ref<string | null>(null)
const sending = ref(false)
const reconnecting = ref(false)

const conversation = shallowRef<SupportConversation | null>(null)
const messages = ref<SupportMessage[]>([])
/** 正在输入的对端；空串表示没有 */
const peerTyping = ref('')

let socket: SupportSocket | null = null
let typingSentAt = 0
let typingClearTimer: ReturnType<typeof setTimeout> | null = null

const title = computed(() => liveSupportTitle.value || t('support.title'))

/** 库的 participants 里 "me" 只是固定字面量，用来判定哪侧靠右 */
const participants = computed<ChatParticipant[]>(() => [
  { id: 'me', name: t('support.you') },
  {
    id: 'agent',
    name:
      conversation.value?.agent_id && conversation.value.agent_id > 0
        ? t('support.agent')
        : t('support.system'),
  },
])

/** 字段名对齐 model/support.go，author 只区分"我"和"对面"两档 */
function toChatMessage(msg: SupportMessage): ChatMessage {
  return {
    id: msg.id,
    author: msg.author_type === 'guest' || msg.author_type === 'user' ? 'me' : 'agent',
    type: 'text',
    data: { text: msg.content, meta: msg.author_name || undefined },
    timestamp: new Date(msg.created_at * 1000).toISOString(),
  }
}

/**
 * 欢迎语做成 id=0 的本地系统消息挂在最前面，而不是落库。
 * 落库的话每开一次窗口就多一条一模一样的记录，客服侧列表会被刷屏；
 * id=0 只是库内部用的 React key，不会与真实消息（从 1 开始）冲突。
 */
const chatMessages = computed<ChatMessage[]>(() => {
  const list: ChatMessage[] = []
  const welcome = liveSupportWelcome.value || t('support.welcome')
  if (welcome) {
    list.push({
      id: 0,
      author: 'system',
      type: 'system',
      data: { text: welcome },
    })
  }
  list.push(...messages.value.map(toChatMessage))
  if (peerTyping.value) {
    list.push({ author: 'agent', type: 'typing', data: { text: peerTyping.value } })
  }
  return list
})

const isClosed = computed(() => conversation.value?.status === 'closed')

// ---------- 主题色 ----------
// 深色切换后要重新取，否则窗口还是浅色底
const themeTick = ref(0)
const colors = ref<ChatColors>({
  header: { bg: '#3f3ad4', text: '#ffffff' },
  launcher: { bg: '#3f3ad4' },
  messageList: { bg: '#ffffff' },
  sentMessage: { bg: '#3f3ad4', text: '#ffffff' },
  receivedMessage: { bg: '#f0f1f2', text: '#050503' },
  userInput: { bg: '#f8f9fa', text: '#38383d' },
})

function resolveColors() {
  if (typeof window === 'undefined') return
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => {
    const value = cs.getPropertyValue(name).trim()
    return value || fallback
  }
  const brand = v('--color-brand', '#3f3ad4')
  // 发送气泡用实心主色，白字要在任何主题下都能看清 —— 亮色主题的
  // --color-brand 是深紫蓝（7.59:1），暗色下是提亮版（浅底需配深字）。
  const solid = v('--color-accent', brand)
  const onSolid = v('--color-fg-onAccent', '#ffffff')
  const isDarkTheme = document.documentElement.classList.contains('dark')
  colors.value = {
    header: { bg: brand, text: isDarkTheme ? '#0a0a0b' : '#ffffff' },
    launcher: { bg: brand },
    messageList: { bg: v('--color-bg-inset', '#f0f1f2') },
    sentMessage: { bg: solid, text: onSolid },
    receivedMessage: {
      bg: v('--color-bg-elevated', '#ffffff'),
      text: v('--color-fg', '#050503'),
    },
    userInput: {
      bg: v('--color-bg-muted', '#f8f9fa'),
      text: v('--color-fg-secondary', '#38383d'),
    },
  }
}

watch(themeTick, resolveColors)

// ---------- 数据 ----------
/** 用已有消息里最大的 id 做增量游标。列表按 id 升序，取最后一条即可 */
function lastMessageId(): number {
  return messages.value.length ? messages.value[messages.value.length - 1]!.id : 0
}

/** 按 id 去重合并，避免 WS 推送与 HTTP 回包撞车时出现重影 */
function mergeMessages(incoming: SupportMessage[]) {
  if (!incoming.length) return
  const seen = new Set(messages.value.map((m) => m.id))
  const merged = [...messages.value]
  for (const msg of incoming) {
    if (seen.has(msg.id)) continue
    seen.add(msg.id)
    merged.push(msg)
  }
  merged.sort((a, b) => a.id - b.id)
  messages.value = merged
}

async function loadConversation() {
  loading.value = true
  loadError.value = null
  try {
    const payload = await getSupportConversation()
    conversation.value = payload.conversation
    messages.value = payload.messages ?? []
    unread.value = 0
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** WS 断线期间漏掉的消息用 after_id 补齐 */
async function syncMissed() {
  const conv = conversation.value
  if (!conv) return
  try {
    mergeMessages(await getSupportMessages(conv.id, lastMessageId()))
  } catch {
    /* 补齐失败不打断使用，下次重连再试 */
  }
}

function connect() {
  const conv = conversation.value
  if (!conv || socket) return
  socket = new SupportSocket(conv.id, {
    onEvent: handleSocketEvent,
    onReconnect: () => {
      reconnecting.value = false
      void syncMissed()
    },
    onError: () => {
      /* 单条事件级错误：不弹给用户，重连逻辑在 socket 内部 */
    },
  })
  socket.connect()
}

function handleSocketEvent(event: SupportSocketEvent) {
  if (event.type === 'typing') {
    if (event.sender === 'agent' && isOpen.value) markPeerTyping()
    return
  }
  if (event.type !== 'message' || !event.message) return

  const msg = event.message
  // 自己发的已经由 POST 的返回值入列，这里只收对端的
  const mine = msg.author_type === 'guest' || msg.author_type === 'user'
  if (mine) return
  mergeMessages([msg])
  if (isOpen.value) unread.value = 0
  else unread.value += 1
}

function markPeerTyping() {
  peerTyping.value = t('support.agent')
  if (typingClearTimer) clearTimeout(typingClearTimer)
  typingClearTimer = setTimeout(() => {
    peerTyping.value = ''
  }, 4_000)
}

// ---------- 交互 ----------
function openWindow() {
  isOpen.value = true
  unread.value = 0
  if (!conversation.value && !loading.value) void loadConversation().then(connect)
}

function closeWindow() {
  isOpen.value = false
}

async function handleMessageWasSent(message: ChatMessage) {
  const conv = conversation.value
  const text = message.data?.text?.trim()
  if (!conv || !text || sending.value) return

  // 会话已结束：库没有 disabled 输入框的 prop，只能在这里拦住，
  // 并把刚被清空的输入框重新填回去 —— 否则用户的长段留言会被吞掉。
  if (isClosed.value) {
    sendError.value = t('support.closedHint')
    await nextTick()
    restoreInput(text)
    return
  }

  sending.value = true
  sendError.value = null
  try {
    mergeMessages([await sendSupportMessage(conv.id, text)])
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : t('support.sendFailed')
    await nextTick()
    restoreInput(text)
  } finally {
    sending.value = false
  }
}

/**
 * 把文本塞回库的输入框。它是一个 contenteditable div，没有对外接口，
 * 只能按 DOM 找；找不到就放弃（用户重敲一遍，好过发送失败后静默丢内容）。
 */
function restoreInput(text: string) {
  const el = document.querySelector<HTMLElement>(
    '.sc-user-input--text[contenteditable="true"]',
  )
  if (!el) return
  el.textContent = text
  el.focus()
}

/** 输入即上报，节流 2s —— 后端只中转不落库，没必要每个字符都发 */
function handleType() {
  const now = Date.now()
  if (now - typingSentAt < 2_000) return
  typingSentAt = now
  socket?.sendTyping()
}

async function endConversation() {
  const conv = conversation.value
  if (!conv) return
  try {
    await closeSupportConversation(conv.id)
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : t('support.sendFailed')
    return
  }
  socket?.close()
  socket = null
  conversation.value = null
  messages.value = []
  await loadConversation()
  connect()
}

// 主题切换（.dark 类挂在 <html>）时重解颜色
let themeObserver: MutationObserver | null = null

onMounted(() => {
  resolveColors()
  themeObserver = new MutationObserver(() => {
    themeTick.value += 1
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
})

onBeforeUnmount(() => {
  socket?.close()
  socket = null
  if (typingClearTimer) clearTimeout(typingClearTimer)
  themeObserver?.disconnect()
  themeObserver = null
})
</script>

<template>
  <div v-if="liveSupportEnabled && routeAllowed" class="support-widget">
    <!-- 聊天窗。始终挂载、用 isOpen 控制显隐：库在挂载时才测量滚动高度，
         反复 v-if 会让每次打开都停在底部而不是记住位置。 -->
    <BeautifulChat
      v-show="isOpen"
      :participants="participants"
      :message-list="chatMessages"
      :colors="colors"
      :title="title"
      :placeholder="t('support.placeholder')"
      :show-typing-indicator="t('support.typing')"
      :is-open="isOpen"
      :show-emoji="false"
      :show-file="false"
      :show-edition="false"
      :show-deletion="false"
      :show-typing-indicator-switch="false"
      :show-close-button="false"
      :show-minimize-button="false"
      :show-launcher="false"
      :always-scroll-to-bottom="true"
      :message-styling="false"
      :on-message-was-sent="handleMessageWasSent"
      :close="closeWindow"
      @on-type="handleType"
    />

    <!-- 会话工具条。库本身不带"结束会话"，而访客需要一个明确的收尾动作 ——
         否则会话永远停在 open，客服侧列表越积越长。 -->
    <div v-if="isOpen" class="support-actions">
      <span v-if="isClosed" class="support-actions__note">{{ t('support.closedHint') }}</span>
      <button
        type="button"
        class="support-actions__btn"
        :class="{ 'support-actions__btn--primary': isClosed }"
        @click="endConversation"
      >
        {{ isClosed ? t('support.reopen') : t('support.close') }}
      </button>
    </div>

    <!-- 自己画的悬浮气泡 + 未读红点 -->
    <button
      v-if="!isOpen"
      type="button"
      class="support-bubble"
      :aria-label="t('support.launcher')"
      @click="openWindow"
    >
      <MessageCircle :size="22" />
      <span v-if="unread > 0" class="support-bubble__badge">
        {{ unread > 99 ? '99+' : unread }}
      </span>
    </button>

    <!-- 加载失败/发送失败/重连中：库本身不做这些状态 -->
    <div v-if="isOpen && (loadError || sendError || reconnecting)" class="support-status">
      <span v-if="reconnecting">{{ t('support.reconnecting') }}</span>
      <span v-else-if="loadError">{{ t('support.loadFailed') }}</span>
      <span v-else>{{ sendError }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 气泡与库的窗口都贴在右下角。库的窗口自带 z-index，
   这里给整个容器一个更高的层级，保证不被站点 header(z-50) 盖住。 */
.support-widget {
  position: fixed;
  inset: auto 0 0 auto;
  z-index: 60;
}

.support-bubble {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 9999px;
  color: #fff;
  background: var(--color-brand);
  box-shadow: var(--shadow-lg);
  transition: transform var(--duration-fast) var(--ease-out);
}

.support-bubble:hover {
  transform: translateY(-2px);
}

.support-bubble:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
}

.support-bubble__badge {
  position: absolute;
  top: -0.25rem;
  right: -0.25rem;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border-radius: 9999px;
  background: var(--color-danger-dot-fg);
  color: #fff;
  font-size: 0.6875rem;
  line-height: 1.25rem;
  text-align: center;
}

.support-status {
  position: fixed;
  right: 1.5rem;
  bottom: 0.25rem;
  max-width: 18rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  color: var(--color-warning-fg);
  font-size: 0.75rem;
}

/* 工具条压在库的聊天窗下沿。库把窗口固定为 380x460 且右下角留 1.5rem，
   这里用同样的水平锚点，纵向贴在窗口底边之上一点。 */
.support-actions {
  position: fixed;
  right: 1.5rem;
  bottom: 1.35rem;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  width: 23.75rem;
  max-width: calc(100vw - 3rem);
  padding: 0.5rem 0.75rem;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-top: none;
  box-shadow: var(--shadow-sm);
}

.support-actions__note {
  flex: 1;
  color: var(--color-fg-muted);
  font-size: 0.75rem;
  line-height: 1.3;
}

.support-actions__btn {
  flex: none;
  padding: 0.25rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-fg-secondary);
  font-size: 0.75rem;
}

.support-actions__btn:hover {
  background: var(--color-bg-muted);
}

.support-actions__btn--primary {
  border-color: transparent;
  background: var(--color-brand);
  color: #fff;
}
</style>
