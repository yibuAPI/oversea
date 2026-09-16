<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { MessageCircle, Plus, X } from 'lucide-vue-next'
import type {
  ChatColors,
  ChatMessage,
  ChatParticipant,
} from 'vue3-beautiful-chat'
import { useSiteStore } from '@/stores/site'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
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
/** 结束会话的二次确认弹窗 */
const confirmCloseOpen = ref(false)
/** 正在关闭/重建会话，期间按钮置忙，避免连点关出两条会话 */
const reopening = ref(false)

const conversation = shallowRef<SupportConversation | null>(null)
const messages = ref<SupportMessage[]>([])
/**
 * 对端正在输入。必须是**字符串**：库的判定是 `showTypingIndicator !== ''`，
 * 传 boolean false 反而会被判成"要显示"（false !== '' 为真）。空串＝不显示。
 */
const peerTyping = ref('')

let socket: SupportSocket | null = null
/** 这条会话的 WS 是否成功连上过，用来区分"重连中"和"还没连上" */
let everConnected = false
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
    // 刻意不传 data.meta。库在气泡下面额外渲染一行 .sc-message--meta 显示作者名
    // （TextMessage 里是 `data.meta ? <p class="sc-message--meta"> : 空`），
    // 所以只要不给 meta，那行就不会出现 —— 不用靠 CSS 去藏。
    // 谁说的话由左右位置和配色已经说明白了，再挂一行名字纯属噪音。
    data: { text: msg.content },
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
  // 不在这里拼"对方正在输入"的消息：库自己有一个打字气泡，开关就是
  // showTypingIndicator 这个 prop（非空即显示，见模板处的说明）。
  // 两边都塞会同时冒出两个气泡，所以只留库那一个。
  return list
})

const isClosed = computed(() => conversation.value?.status === 'closed')

// ---------- 头部状态 ----------
/** 有对方在（客服）还是系统自动回复 —— 决定头部副标题写谁 */
const agentAssigned = computed(
  () => (conversation.value?.agent_id ?? 0) > 0,
)
/** WS 是否已连上。首次连接也置位（见 SupportSocket 的 onOpen） */
const connected = ref(false)
/**
 * 连接断开、正在退避重连。只在**连上过之后**断开才置位 ——
 * 首次连接就失败时用户看到"连接已断开"会莫名其妙（本来就没连上过），
 * 那种情况下继续走 connected=false 的"连接中"更贴近实情。
 */
const reconnecting = ref(false)

/**
 * 头部那一行小字。顺序就是优先级：连不上 / 加载失败 / 已结束 / 连上了。
 * 不用"在线"这类词 —— 后端只在客服工作台暴露访客在线状态，访客侧没有
 * 客服是否在线的接口，写了就是编的。
 */
const statusText = computed(() => {
  if (loadError.value) return t('support.loadFailed')
  if (reconnecting.value) return t('support.reconnecting')
  if (isClosed.value) return t('support.closed')
  if (loading.value || !connected.value) return t('support.connecting')
  return agentAssigned.value ? t('support.agentOnline') : t('support.systemOnline')
})

const statusTone = computed(() => {
  if (loadError.value || reconnecting.value) return 'warn'
  if (isClosed.value) return 'muted'
  if (loading.value || !connected.value) return 'pending'
  return 'ok'
})

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

/**
 * 库只往气泡和列表上**内联** color/backgroundColor（见 Message 的
 * sentColorsStyle / receivedColorsStyle 和 MessageList 的 messageList 绑定），
 * 内联样式优先于样式表里任何不带 !important 的规则 —— 所以这几个值必须从
 * 这里给对，样式表里改是改不动的（踩过：both 写了 background 但没生效）。
 *
 * 其余属性（圆角、间距、字号、边框）库里没有内联，走 <style> 就够，
 * 两边各管一头，不要重复表达同一件事。
 */
function resolveColors() {
  if (typeof window === 'undefined') return
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => {
    const value = cs.getPropertyValue(name).trim()
    return value || fallback
  }
  const brand = v('--color-brand', '#3f3ad4')
  colors.value = {
    // 头部走参考图那种白底 + 发丝线（样式表画），跟窗口同色，不再是一整块主色
    header: {
      bg: v('--color-bg', '#ffffff'),
      text: v('--color-fg', '#050503'),
    },
    launcher: { bg: brand },
    // 消息区跟着窗口底色走：气泡才有对比（原先用 --color-bg-inset，
    // 整块灰底 + 灰气泡，层次全糊在一起）
    messageList: { bg: v('--color-bg', '#ffffff') },
    sentMessage: {
      bg: v('--color-accent', brand),
      text: v('--color-fg-onAccent', '#ffffff'),
    },
    // 接收气泡也走这个色。typing（对方正在输入）和 system（欢迎语）
    // 都取 author 不是 me 的那一档，所以三者同一个底 —— 形状上再区分。
    receivedMessage: {
      bg: v('--color-bg-muted', '#f8f9fa'),
      text: v('--color-fg', '#050503'),
    },
    // 这个值库内联给两处：.sc-user-input--text（输入的文字）和发送键图标
    // （IconSend 的 color → svg 的 fill）。发送键是实心蓝圆，图标必须取白，
    // 所以这里给白；输入文字那份由样式表单独盖成正文色 —— 之前只给白没盖，
    // 结果输入的文字是白底白字，肉眼完全看不见（实测 computedColor 是
    // rgb(255,255,255)，背景也是白）。不盖不行，因为库是内联的，只能靠样式表压。
    userInput: {
      bg: v('--color-bg', '#ffffff'),
      text: v('--color-fg-onAccent', '#ffffff'),
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
  reconnecting.value = false
  connected.value = false
  socket = new SupportSocket(conv.id, {
    onEvent: handleSocketEvent,
    onOpen: () => {
      reconnecting.value = false
      connected.value = true
      everConnected = true
    },
    onReconnect: () => {
      reconnecting.value = false
      void syncMissed()
    },
    // 断开时把 connected 落回去，否则头部会一直显示"在线" —— SupportSocket
    // 在内部自动退避重连，不接这个回调的话，掉线后界面永远停在"已连接"。
    // 只有"连上过又掉"才叫重连；首次就没连上继续显示"连接中"。
    onClose: () => {
      connected.value = false
      reconnecting.value = everConnected
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
  // 会话状态变更（客服结束会话、指派客服）。后端广播的是 type: "conversation"，
  // status 在 event.message.status 里 —— 不接这个，客服那边点了结束，
  // 访客窗口毫不知情，输入框还能打字，发出去才知道会话没了。
  if (event.type === 'conversation') {
    const status = (event.message as unknown as { status?: string } | undefined)?.status
    const conv = conversation.value
    if (status === 'closed' && conv) {
      conversation.value = { ...conv, status: 'closed' }
      markPeerTypingClear()
    }
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
  // 值本身不重要，非空即可 —— 库只拿它当开关，文字不渲染
  peerTyping.value = '1'
  if (typingClearTimer) clearTimeout(typingClearTimer)
  typingClearTimer = setTimeout(() => {
    peerTyping.value = ''
  }, 4_000)
}

/** 会话结束/切换时把"正在输入"清掉，否则会一直挂在消息列表底部 */
function markPeerTypingClear() {
  peerTyping.value = ''
  if (typingClearTimer) {
    clearTimeout(typingClearTimer)
    typingClearTimer = null
  }
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

async function handleMessageWasSent(message: ChatMessage): Promise<boolean> {
  const conv = conversation.value
  const text = message.data?.text?.trim()
  if (!conv || !text || sending.value) return false

  // 会话已结束：库没有 disabled 输入框的 prop，只能在这里拦住。
  //
  // 返回值决定库是否清空输入框 —— UserInput._checkSubmitSuccess 里是
  // `(D === void 0 || D) && (this.$refs.userInput.innerHTML = "")`，
  // 只有 undefined / 真值才清。所以失败时**必须 return false**，
  // 否则用户刚敲的长段留言会被库自己抹掉（在回调之后再回填 DOM 也来不及，
  // 库的 .then() 会晚一步执行并把 innerHTML 清空）。
  if (isClosed.value) {
    sendError.value = t('support.closedHint')
    return false
  }

  sending.value = true
  sendError.value = null
  try {
    mergeMessages([await sendSupportMessage(conv.id, text)])
    return true
  } catch (e) {
    sendError.value = e instanceof Error ? e.message : t('support.sendFailed')
    return false
  } finally {
    sending.value = false
  }
}

/** 输入即上报，节流 2s —— 后端只中转不落库，没必要每个字符都发 */
function handleType() {
  const now = Date.now()
  if (now - typingSentAt < 2_000) return
  typingSentAt = now
  socket?.sendTyping()
}

async function endConversation() {
  if (reopening.value) return
  reopening.value = true
  try {
    // 已结束的会话不用再关一次，直接换新会话
    const conv = conversation.value
    if (conv && !isClosed.value) {
      try {
        await closeSupportConversation(conv.id)
      } catch (e) {
        sendError.value = e instanceof Error ? e.message : t('support.sendFailed')
        return
      }
    }
    await startFreshConversation()
  } finally {
    reopening.value = false
  }
}

/** 换一条新会话：断开旧通道 → 重新拉取（后端按 open 状态过滤，会新建）→ 重连 */
async function startFreshConversation() {
  socket?.close()
  socket = null
  // 换了一条会话，上一条的"连上过"不继承 —— 否则新通道还没连上就先显示"重连中"
  everConnected = false
  conversation.value = null
  messages.value = []
  unread.value = 0
  markPeerTypingClear()
  await loadConversation()
  connect()
}

/** 二次确认。文案在 i18n 的 support.closeConfirm */
function onConfirmClose() {
  confirmCloseOpen.value = false
  void endConversation()
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
         反复 v-if 会让每次打开都停在底部而不是记住位置。

         show-typing-indicator 绑的是 peerTyping 而不是文案：库里对它的判定是
         `v-show="showTypingIndicator !== ''"` —— 它是个**开关**，那个字符串
         从来不渲染成文字。传一个常量文案（原来的 t('support.typing')）等于
         让打字气泡常驻，没人打字时也一直挂在那；空串才是"不显示"。 -->
    <BeautifulChat
      v-show="isOpen"
      :participants="participants"
      :message-list="chatMessages"
      :colors="colors"
      :title="title"
      :placeholder="t('support.placeholder')"
      :show-typing-indicator="peerTyping"
      :is-open="isOpen"
      :open="openWindow"
      :show-emoji="false"
      :show-file="false"
      :show-edition="false"
      :show-deletion="false"
      :show-close-button="false"
      :show-minimize-button="false"
      :show-launcher="false"
      :always-scroll-to-bottom="true"
      :message-styling="false"
      :on-message-was-sent="handleMessageWasSent"
      :close="closeWindow"
      @on-type="handleType"
    >
      <!-- 库的 header 插槽替换掉它自带的标题行（那个标题行有两处靠不住：
           一是 ChatWindow 根本没把 showCloseButton 透传给 Header，所以右上角
           那个 ✕ 永远是 undefined → 不渲染，窗口一旦打开就关不掉；二是
           disableUserListToggle 也没透传，于是标题带着一个 onClick 去切
           participants 列表 —— 点标题会把消息列表换成名单）。
           这里整个换成自己的：标题 + 状态行 + 结束会话 + 收起，顺带把上面
           两个问题一起绕过去。 -->
      <template #header>
        <div class="support-head">
          <div class="support-head__text">
            <p class="support-head__title">{{ title }}</p>
            <p class="support-head__status" :data-tone="statusTone">
              <span class="support-head__dot" aria-hidden="true" />
              {{ statusText }}
            </p>
          </div>
          <button
            type="button"
            class="support-head__btn"
            :disabled="reopening"
            @click="isClosed ? endConversation() : (confirmCloseOpen = true)"
          >
            {{ isClosed ? t('support.reopen') : t('support.close') }}
          </button>
          <button
            type="button"
            class="support-head__icon"
            :aria-label="t('support.collapse')"
            @click="closeWindow"
          >
            <X :size="16" />
          </button>
        </div>
      </template>
    </BeautifulChat>

    <!-- 会话已结束的说明。库没有这种状态条，但"已结束"又是必须说清楚的：
         不说明的话访客会以为还能发，敲完才被拦下。
         贴在输入框上方而不是窗口外面 —— 外面那块悬浮白条正是要拆掉的东西。 -->
    <div v-if="isOpen && isClosed" class="support-note">
      <span>{{ t('support.closedHint') }}</span>
      <button
        type="button"
        class="support-note__btn"
        :disabled="reopening"
        @click="endConversation()"
      >
        <Plus :size="13" />
        {{ t('support.reopen') }}
      </button>
    </div>

    <!-- 加载失败/发送失败/重连中：库本身不做这些状态 -->
    <div v-if="isOpen && (loadError || sendError || reconnecting)" class="support-status">
      <span v-if="reconnecting">{{ t('support.reconnecting') }}</span>
      <span v-else-if="loadError">{{ t('support.loadFailed') }}</span>
      <span v-else>{{ sendError }}</span>
    </div>

    <!-- 自己画的悬浮气泡 + 未读红点。库的 launcher 已经关掉
         （showLauncher=false），它的样式是圆形 + 固定紫色，跟站内对不上；
         这里的图标、尺寸、层级都能自己说了算，未读角标也只有自己有。 -->
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

    <!-- 结束会话的二次确认。结束不可撤销（客服侧会同步关掉），
         误触代价是新开一条会话，值得拦一下 -->
    <AppModal
      :open="confirmCloseOpen"
      :title="t('support.close')"
      :width="380"
      @close="confirmCloseOpen = false"
    >
      <p class="text-[13.5px] text-fg-secondary">{{ t('support.closeConfirm') }}</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmCloseOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton variant="danger" @click="onConfirmClose">
          {{ t('support.close') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 容器本身不画东西，但必须是 fixed：窗口内那两条浮动提示
   （.support-note / .support-status）用 absolute 挂在这里当包含块，
   零尺寸也行 —— 它们只取 left/right 的基准，纵向仍按视口写。
   库的窗口自带 z-index，这里给容器更高的层级，保证不被站点 header(z-50) 盖住。 */
.support-widget {
  position: fixed;
  inset: auto 0 0 auto;
  z-index: 60;
}

/* ------------------------------------------------------------------
   整体
   库的 .sc-chat-window 自带 width/height/right/bottom/背景/圆角/阴影，
   这里全部接管：位置尺寸写自己的，配色改走 CSS 变量而不是 :colors ——
   库拿到的颜色是 getComputedStyle 解析出来的**字面量**，而这些元素本身
   就在主题里，直接吃 var() 更省事，也少一层"解析出来的值过期了"的风险。
   :colors 仍然要传（库对 messageList / sentMessage 等做内联样式赋值，
   那些是真的读不到，见 resolveColors）。
   ------------------------------------------------------------------ */
.support-widget :deep(.sc-chat-window) {
  --sp-head-h: 3.75rem;

  right: 1.5rem;
  bottom: 1.5rem;
  width: 23.5rem; /* 376px */
  height: min(36.5rem, calc(100vh - 4rem));
  max-height: none;
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  box-shadow: var(--shadow-lg);
  font-family: inherit;
  overflow: hidden;
}

/* 头部。库的 .sc-header 是 min-height:75px、padding:10px、box-shadow，
   背景/文字色由内联样式给（见 resolveColors）。这里只改库没有内联的部分：
   高度、内边距、分隔线。 */
.support-widget :deep(.sc-header) {
  min-height: var(--sp-head-h);
  padding: 0 0.75rem 0 1.125rem;
  align-items: center;
  box-shadow: none;
  border-bottom: 1px solid var(--color-border);
}

/* 库的标题槽是 flex:1 的普通 div，还挂着一个切换 participants 列表的
   onClick（ChatWindow 没把 disableUserListToggle 透传下去）。点了没事但
   会把消息列表换成名单，所以整块关掉指针事件 —— 头里的按钮再单独打开。
   顺带关掉库那圈 hover 阴影。 */
.support-widget :deep(.sc-header--title) {
  padding: 0;
  font-size: inherit;
  pointer-events: none;
}

.support-widget :deep(.sc-header--title.enabled) {
  cursor: default;
}

.support-widget :deep(.sc-header--title.enabled:hover) {
  box-shadow: none;
}

/* 头里的按钮要能点，把上面关掉的指针事件还回来 */
.support-head__btn,
.support-head__icon {
  pointer-events: auto;
}

.support-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.support-head__text {
  flex: 1;
  min-width: 0;
}

.support-head__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 参考图里标题下面那行小字：一个圆点 + 状态。不写"在线"这类没有依据的话，
   文案见 statusText。 */
.support-head__status {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  margin: 0.125rem 0 0;
  font-size: 0.75rem;
  line-height: 1.2;
  color: var(--color-fg-muted);
}

.support-head__dot {
  flex: none;
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: 9999px;
  background: currentColor;
}

.support-head__status[data-tone='ok'] {
  color: var(--success-fg);
}

.support-head__status[data-tone='warn'] {
  color: var(--warning-fg);
}

.support-head__status[data-tone='pending'] {
  color: var(--color-fg-muted);
}

.support-head__status[data-tone='muted'] {
  color: var(--color-fg-subtle);
}

/* 头里的次级按钮：结束会话 / 开始新会话 */
.support-head__btn {
  flex: none;
  padding: 0.3125rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-fg-secondary);
  font-size: 0.75rem;
  line-height: 1.2;
  white-space: nowrap;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.support-head__btn:hover:not(:disabled) {
  background: var(--color-bg-muted);
  border-color: var(--color-border-strong);
}

.support-head__btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.support-head__icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-fg-muted);
  transition:
    background var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.support-head__icon:hover {
  background: var(--color-bg-muted);
  color: var(--color-fg);
}

.support-head__icon:focus-visible,
.support-head__btn:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 1px;
}

/* 消息区。库是 height:80% + padding:40px 0 —— 80% 是相对整窗算的，
   再叠上头部和输入框就会溢出、被 flex 压缩，滚动条位置因此飘忽。
   改成 flex:1 让它老老实实吃掉剩余高度。底色由内联样式给，见 resolveColors。 */
.support-widget :deep(.sc-message-list) {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
  padding: 1rem 1.125rem;
  overscroll-behavior: contain;
}

/* 接收侧本来会画一个 30px 头像 + 15px 间距（库只对发送侧 .sent 做了
   display:none），于是收到消息时气泡被推到 45px 内缩，跟发送侧和输入框
   都不在一条线上。这里一并藏掉，两侧都是 18px 内缩、与输入框文字同一条
   竖直基线；谁说的由左右位置和配色已经分得很清。 */
.support-widget :deep(.sc-message--avatar) {
  display: none;
}

/* 覆盖掉库的 .sc-message{width:300px}。 */
.support-widget :deep(.sc-message) {
  width: auto;
  max-width: 100%;
  padding-bottom: 0.625rem;
  animation: support-bubble-in 0.22s var(--ease-out) both;
}

@keyframes support-bubble-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 气泡。库是 5px 20px / 圆角 6px；改成更舒展的内边距、14px 字号、
   以及"朝自己那一侧收角"的不对称圆角 —— 这是聊天界面最有辨识度的一笔。
   底色由库内联（sentColorsStyle / receivedColorsStyle），这里只管形状。 */
.support-widget :deep(.sc-message--content .sc-message--text) {
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-lg);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.55;
  word-break: break-word;
}

.support-widget :deep(.sc-message--content.sent .sc-message--text) {
  max-width: 80%;
  margin-left: auto;
  margin-right: 0;
  border-bottom-right-radius: var(--radius-sm);
}

.support-widget :deep(.sc-message--content.received .sc-message--text) {
  max-width: 80%;
  margin-right: auto;
  border-bottom-left-radius: var(--radius-sm);
}

/* 欢迎语（库的 system 类型）。原来是斜体 + opacity .55 的一行灰字，
   看着像报错。改成居中的浅色胶囊，像一句"开场白"。
   注意它取的是 receivedMessage 那档色，跟接收气泡同底 —— 所以靠形状区分。 */
.support-widget :deep(.sc-message--system) {
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-style: normal;
  line-height: 1.5;
  opacity: 1;
  text-align: center;
}

.support-widget :deep(.sc-message--content.system .sc-message--system) {
  max-width: 88%;
}

/* 欢迎语要居中。库自己的 system 样式只写了 text-align，居中靠的是外层
   .sc-message--content.system 上的 justify-content:center —— 而那条规则只对
   author 恰好是 system 的消息生效。这行欢迎语是本地拼的，author 给的是
   "agent"，于是 content 带的是 received 类，整块被推到右边。
   这里按结构来选（.sc-message 里一种气泡只出现一次），不吃那个类名。 */
.support-widget :deep(.sc-message .sc-message--system) {
  margin-left: auto;
  margin-right: auto;
  /* 胶囊收着文字宽度。max-width 88% 只封上限，撑满时它仍会是一条等宽长条
     （窄屏尤其明显，看着像分隔线而不是一句开场白）—— fit-content 才是本意。 */
  width: fit-content;
}

/* 正在输入：三个跳动的点。库给的是 17px 20px 的方块，这里收成与接收
   气泡同尺寸的小胶囊（底色同样来自 receivedColorsStyle 的内联值）。 */
.support-widget :deep(.sc-typing-indicator) {
  padding: 0.625rem 0.75rem;
  border-radius: var(--radius-lg);
  border-bottom-left-radius: var(--radius-sm);
}

.support-widget :deep(.sc-typing-indicator span) {
  width: 0.375rem;
  height: 0.375rem;
  margin-right: 0.1875rem;
  background: var(--color-fg-subtle);
}

/* 输入区。库是 min-height:55px 的 flex，左边一个 contenteditable 撑 300px，
   右侧 .sc-user-input--buttons 绝对定位 right:30px —— 两者各占一块、宽度
   写死，所以在 376px 的窗里看着是一个大空框加一个飘在中间的发送键。
   这里改成：外层当容器，内容一行；输入框 flex:1 吃掉剩余宽度，
   按钮组回到正常流（position:static），发送键做成实心圆。
   底色/文字色由内联样式给，见 resolveColors。 */
.support-widget :deep(.sc-user-input) {
  min-height: 0;
  flex: none;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem 0.75rem 1.125rem;
  border-top: 1px solid var(--color-border);
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

/* 库有 .sc-user-input.active 的聚焦态（改底色 + 上投影），会把整条输入区
   点亮成另一块，和窗口分层。这里让它与常态一致：内联的 background 压在
   .sc-user-input 上不会变，只有这条 !important 的内联式声明会变，
   所以补一条同样带 !important 的值把它按回去（库没有内联 box-shadow，
   直接压掉即可）。 */
.support-widget :deep(.sc-user-input.active) {
  background: var(--color-bg) !important;
  box-shadow: none;
}

/* 输入文字的正文色。库把 colors.userInput.text 内联成白色（那句是给发送键
   图标用的，见 resolveColors 里的说明），白字压在白底上等于看不见，这里必须
   压回来。用 !important 的理由：内联样式没有别的办法覆盖，而我们这条选择器
   权重本来就更高（.support-widget + :deep 展开成两层，加上类名共三档），
   写在一起只是为了不依赖权重精算。 */
.support-widget :deep(.sc-user-input--text) {
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  max-height: 7.5rem;
  padding: 0.5rem 0;
  border: none;
  font-size: 0.875rem;
  line-height: 1.5;
  background: none;
  color: var(--color-fg) !important;
  caret-color: var(--color-fg);
}

/* 占位符。库用 :empty::before 的 content 画，颜色跟着 color 走（现在
   color 已经是正文的深色，占位符再浅一档，让"这是提示"一眼能看出来）。 */
.support-widget :deep(.sc-user-input--text:empty::before) {
  color: var(--color-fg-subtle);
}

/* .sc-user-input--buttons 原本是 width:100px + position:absolute + right:30px。
   回到正常流后宽度交给内容。 */
.support-widget :deep(.sc-user-input--buttons) {
  position: static;
  flex: none;
  width: auto;
  height: auto;
  align-items: center;
  gap: 0.25rem;
}

/* 库在按钮组里塞了一个**空的** .sc-user-input--button 当占位（CSS 里它
   有 40px 宽），现在不需要。注意别整类 display:none —— 发送键外面也套着
   同一个类名（库的常量 He = "sc-user-input--button"），整类隐藏会把发送键
   一起干掉（踩过：发送键量出来 0×0）。只藏空的那个。 */
.support-widget :deep(.sc-user-input--button:empty) {
  display: none;
}

.support-widget :deep(.sc-user-input--button) {
  width: auto;
  height: auto;
  margin: 0;
}

.support-widget :deep(.sc-user-input--button-icon-wrapper) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  /* 图标 fill 是 currentColor，从祖先继承过来；显式给白，别依赖继承链 */
  color: var(--color-fg-onAccent);
  background: var(--color-accent);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
}

.support-widget :deep(.sc-user-input--button-icon-wrapper:hover) {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
}

.support-widget :deep(.sc-user-input--button-icon-wrapper svg) {
  width: 1rem;
  height: 1rem;
}

/* ------------------------------------------------------------------
   会话状态条 / 错误提示
   都是窗口内的浮动条，绝对定位挂在输入框上方 —— 之前它们（尤其是
   "结束会话"）在窗口外面各占一块，和窗口凑不成一个整体，窄屏下还得
   另写一套坐标躲输入框。放进窗口内就没有这些问题。
   .support-widget 是 position:fixed，作为包含块即可。
   ------------------------------------------------------------------ */
.support-note,
.support-status {
  position: absolute;
  right: 1.5rem;
  width: 23.5rem;
  box-sizing: border-box;
  font-size: 0.75rem;
  line-height: 1.45;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}

/* 库的输入框高度是内容决定的（一行约 44px，多行会顶到 120px），
   所以贴底位置不能写死。用 bottom:1.5rem（窗口下沿）+ 自身高度翻上去，
   再让出约一行输入框的高度 —— 一行时正好落在输入框上方。 */
.support-note {
  bottom: 4.25rem;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-fg-secondary);
}

.support-note__btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border: none;
  border-radius: var(--radius-md);
  background: var(--color-accent);
  color: var(--color-fg-onAccent);
  font-size: 0.75rem;
  white-space: nowrap;
}

.support-note__btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.support-status {
  bottom: 4.25rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-warning-bg);
  border: 1px solid var(--color-warning-border);
  color: var(--color-warning-fg);
}

/* 两条同时出现时错开，避免叠在一起 */
.support-note + .support-status {
  bottom: 7.5rem;
}

/* ------------------------------------------------------------------
   悬浮气泡（自绘，库的 launcher 不接受未读徽标）
   ------------------------------------------------------------------ */
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

/* 窄屏（≤450px）下库把聊天窗改成铺满视口：width/height 100%、right/bottom 0、
   圆角 0。下面这几个覆盖都要跟着让位，否则窗口会缩成右上角一小块。 */
@media (max-width: 450px) {
  /* 容器本身没有 in-flow 内容（子元素全是 fixed/absolute），宽高都是 0。
     桌面端两条提示写的是 right + 固定 width，不依赖包含块，所以没事；
     窄屏要改成"左右都贴边"，那就**必须**依赖包含块了 —— 0 宽的包含块减去
     两侧 inset 只剩负值，条子会被压成一条约 26px 的细线。
     把容器撑满视口宽度，包含块才是窗口宽，left/right 才有意义。 */
  .support-widget {
    inset: auto 0 0 0;
  }

  .support-widget :deep(.sc-chat-window) {
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 0;
  }

  .support-widget :deep(.sc-header) {
    min-height: 3.5rem;
    padding-left: 0.875rem;
  }

  .support-widget :deep(.sc-message-list) {
    padding: 0.875rem;
  }

  .support-widget :deep(.sc-user-input) {
    padding-left: 0.875rem;
  }

  .support-note,
  .support-status {
    right: 0.875rem;
    left: 0.875rem;
    width: auto;
  }
}
</style>
