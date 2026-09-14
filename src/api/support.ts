import { api } from './client'

/**
 * 在线客服（访客侧）。后端实现在 D:\yibuapi：
 *   router/support-router.go  —— 挂在 /api/support，**故意不挂 gzip 中间件**
 *   controller/support.go     —— 访客接口 + 唯一的鉴权边界 findOwnedConversation
 *   service/support_hub.go    —— WebSocket hub，按会话 id 分房间
 *
 * 三条与后端耦合的事实，改动前先看后端：
 * 1. WebSocket 鉴权只能走 query。浏览器 WebSocket API 无法设置自定义请求头，
 *    所以 middleware.AdminAuth 那套 New-Api-User 头在这里用不上 ——
 *    已登录用户靠 session cookie（TryUserAuth），游客靠 ?guest=<token>。
 * 2. 消息走 HTTP POST，不走 WS。这样发送方立刻拿到落库后的 id/created_at
 *    （能对齐去重、能显示真实错误码），WS 只负责把消息推给**对端**。
 * 3. 断线重连后用 after_id 增量补齐，不用全量拉。
 */

// ---------- 游客标识 ----------
// 未登录访客没有 userId，用本地持久化的随机 token 认人。它既是会话检索键
// 也是持有凭证（后端注释里写明：能读到会话就等于持有会话），所以只存本地、
// 不随请求外泄到别处。已登录用户不带它 —— 后端优先认 userId。
const GUEST_TOKEN_KEY = 'onestep:support-guest'

/** 后端 supportGuestTokenFrom 只放行 [A-Za-z0-9_-]，长度 ≤ 64 */
function randomGuestToken(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    // 老浏览器兜底：后端只要求它是不可猜的检索键，不要求密码学强度
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

let guestTokenCache: string | null = null

/** 取（首次访问时生成）游客标识。隐私模式下 localStorage 不可用则退化为内存态 */
export function getGuestToken(): string {
  if (guestTokenCache) return guestTokenCache
  try {
    const stored = localStorage.getItem(GUEST_TOKEN_KEY)
    if (stored && /^[A-Za-z0-9_-]{1,64}$/.test(stored)) {
      guestTokenCache = stored
      return stored
    }
  } catch {
    /* 隐私模式，落到下面生成内存态 */
  }
  const fresh = randomGuestToken()
  guestTokenCache = fresh
  try {
    localStorage.setItem(GUEST_TOKEN_KEY, fresh)
  } catch {
    /* 同上 */
  }
  return fresh
}

// ---------- 类型 ----------
// 字段名与 model/support.go 的 json tag 一一对应，别凭感觉改。

export type SupportAuthorType = 'guest' | 'user' | 'agent' | 'system'
export type SupportConversationStatus = 'open' | 'closed'

export interface SupportConversation {
  id: number
  user_id: number
  guest_token: string
  guest_name: string
  guest_email: string
  status: SupportConversationStatus
  agent_id: number
  unread_for_agent: number
  unread_for_user: number
  last_message: string
  last_message_at: number
  message_count: number
  created_at: number
  updated_at: number
  closed_at: number
}

export interface SupportMessage {
  id: number
  conversation_id: number
  author_type: SupportAuthorType
  author_id: number
  author_name: string
  content: string
  /** Unix 秒 */
  created_at: number
}

export interface SupportSettings {
  title?: string
  welcome?: string
}

export interface SupportConversationPayload {
  conversation: SupportConversation
  messages: SupportMessage[]
  settings: SupportSettings
}

/** service/support_hub.go 的 SupportSocketEvent */
export interface SupportSocketEvent {
  type: 'message' | 'typing' | 'error' | 'ready' | string
  conversation_id?: number
  message?: SupportMessage
  unread?: number
  sender?: 'visitor' | 'agent'
  error?: string
}

// ---------- HTTP ----------

/** 取（或创建）当前访客的会话。打开客服窗时调用，附带回灌历史消息 */
export function getSupportConversation(): Promise<SupportConversationPayload> {
  return api.get<SupportConversationPayload>('/support/conversation', {
    params: { guest: getGuestToken() },
  })
}

/** 增量拉消息。afterId > 0 时只回更新的部分，用于 WS 断线补齐 */
export function getSupportMessages(
  conversationId: number,
  afterId = 0,
): Promise<SupportMessage[]> {
  return api
    .get<{ messages: SupportMessage[] }>(
      `/support/conversation/${conversationId}/messages`,
      { params: { guest: getGuestToken(), after_id: afterId || undefined } },
    )
    .then((d) => d.messages ?? [])
}

export function sendSupportMessage(
  conversationId: number,
  content: string,
): Promise<SupportMessage> {
  return api
    .post<{ message: SupportMessage }>(
      `/support/conversation/${conversationId}/messages`,
      { content },
      { params: { guest: getGuestToken() } },
    )
    .then((d) => d.message)
}

export function closeSupportConversation(conversationId: number): Promise<void> {
  return api.post<void>(
    `/support/conversation/${conversationId}/close`,
    undefined,
    { params: { guest: getGuestToken() } },
  )
}

// ---------- WebSocket ----------

/**
 * 客服连接。**不依赖 axios**：http.baseURL 是 '/api' 这种相对路径，
 * WebSocket 构造器要绝对 URL，所以自己拼。已登录用户也带 guest（后端忽略），
 * 带上能让「同一浏览器先匿名后登录」的两种身份落到同一检索路径上，少一类边界。
 */
export class SupportSocket {
  private ws: WebSocket | null = null
  private closed = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly conversationId: number,
    private readonly handlers: {
      onEvent: (event: SupportSocketEvent) => void
      /** 每次（重）连成功后触发，调用方在这里用 after_id 补齐断线期间的消息 */
      onReconnect?: () => void
      onError?: (message: string) => void
    },
  ) {}

  connect() {
    if (this.closed || typeof WebSocket === 'undefined') return

    const base = import.meta.env.VITE_API_BASE || '/api'
    const url = new URL(
      `${base.replace(/\/+$/, '')}/support/conversation/${this.conversationId}/ws`,
      window.location.href,
    )
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('guest', getGuestToken())

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.handlers.onError?.(e instanceof Error ? e.message : String(e))
      this.scheduleRetry()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      const isResume = this.retries > 0
      this.retries = 0
      if (isResume) this.handlers.onReconnect?.()
    }

    ws.onmessage = (ev) => {
      let parsed: SupportSocketEvent
      try {
        parsed = JSON.parse(ev.data as string) as SupportSocketEvent
      } catch {
        return // 非 JSON 心跳之类，忽略
      }
      if (parsed.type === 'error') {
        this.handlers.onError?.(parsed.error || '')
        return
      }
      this.handlers.onEvent(parsed)
    }

    // onerror 之后一定跟 onclose，重连统一在 onclose 里做，避免计两次
    ws.onclose = () => {
      this.ws = null
      this.scheduleRetry()
    }
  }

  /** 指数退避，上限 15s。窗口关闭后 close() 会置 closed 阻断重连 */
  private scheduleRetry() {
    if (this.closed || this.retryTimer) return
    const delay = Math.min(15_000, 1_000 * 2 ** this.retries)
    this.retries += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  /** 发送「正在输入」。后端只中转、不落库，丢了也无所谓，故失败静默 */
  sendTyping() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'typing' }))
    }
  }

  close() {
    this.closed = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.ws?.close()
    this.ws = null
  }
}

/** 供组件里做「相对时间」展示，保留在同一处便于以后统一格式 */
export function supportMessageTimeText(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleTimeString()
}
