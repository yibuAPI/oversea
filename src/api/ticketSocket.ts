import type { Ticket, TicketMessage } from './tickets'

/**
 * 工单实时推送。后端实现在 D:\yibuapi：
 *   router/ticket-router.go   —— WS 端点独立成组，**故意不继承 /api 组的 gzip 中间件**
 *   controller/ticket_ws.go   —— 握手入口 + 归属校验 + Origin 同源校验
 *   service/ticket_hub.go     —— 按工单 id 分房间的 hub，事件结构 TicketSocketEvent
 *
 * 三条与后端耦合的事实，改动前先看后端：
 * 1. 鉴权只靠同源的 session cookie。工单必须登录（路由用 UserAuth 而非 TryUserAuth），
 *    握手是同源请求、cookie 自动带上，所以**不需要**像在线客服那样往 query 塞 token。
 *    也正因为凭证是 cookie，后端 CheckOrigin 做了同源校验（只比 host 不比协议，
 *    反代后端收到的是 http 而浏览器 Origin 是 https）—— 跨站连不进来。
 * 2. 消息走 HTTP POST 落库，WS 只负责推送。发送方因此立刻拿到 id/created_at，
 *    能去重、能显示真实错误码。广播默认发给房间**所有人**（含发送者自己，因为
 *    controller 拿不到发送者的那条连接），所以客户端要按 sender 过滤自己那侧。
 * 3. 断线重连后直接全量 refetch 详情，不做 after_id 增量 —— 详情接口本就一次
 *    拉全部消息与事件时间线，多一条增量接口只是多一个会漂的状态。
 */

/** 对齐 service/ticket_hub.go 的 TicketSocketEvent json tag */
export interface TicketSocketEvent {
  /** message = 新消息；ticket = 仅工单本身变了（状态/优先级/指派/关闭） */
  type: 'message' | 'ticket' | 'typing' | 'error' | string
  ticket_id?: number
  message?: TicketMessage
  /** 推送前服务端重取的完整快照，未读数与状态都是最新的，直接覆盖本地缓存 */
  ticket?: Ticket
  /** 事件由哪一侧触发。等于自己这侧时说明是自己的动作回声，应丢弃 */
  sender?: 'user' | 'agent'
  error?: string
}

export type TicketSocketRole = 'user' | 'agent'

/**
 * 工单连接。**不依赖 axios**：http.baseURL 是 '/api' 这种相对路径，
 * WebSocket 构造器要绝对 URL，所以自己拼。
 */
export class TicketSocket {
  private ws: WebSocket | null = null
  private closed = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly ticketId: number,
    private readonly handlers: {
      onEvent: (event: TicketSocketEvent) => void
      /** 每次（重）连成功后触发，调用方在这里重取详情补齐断线期间的消息 */
      onReconnect?: () => void
      onError?: (message: string) => void
      /** 连接状态变化，供界面提示「实时」或「已断开，正在重连」 */
      onStatus?: (connected: boolean) => void
    },
    /** 客服工作台传 'agent'，走 /tickets/admin/:id/ws（AdminAuth） */
    private readonly role: TicketSocketRole = 'user',
  ) {}

  connect() {
    if (this.closed || typeof WebSocket === 'undefined') return

    const base = import.meta.env.VITE_API_BASE || '/api'
    const path = this.role === 'agent'
      ? `/tickets/admin/${this.ticketId}/ws`
      : `/tickets/${this.ticketId}/ws`
    const url = new URL(`${base.replace(/\/+$/, '')}${path}`, window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

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
      this.handlers.onStatus?.(true)
      if (isResume) this.handlers.onReconnect?.()
    }

    ws.onmessage = (ev) => {
      let parsed: TicketSocketEvent
      try {
        parsed = JSON.parse(ev.data as string) as TicketSocketEvent
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
      this.handlers.onStatus?.(false)
      this.scheduleRetry()
    }
  }

  /** 指数退避，上限 15s。离开页面后 close() 会置 closed 阻断重连 */
  private scheduleRetry() {
    if (this.closed || this.retryTimer) return
    const delay = Math.min(15_000, 1_000 * 2 ** this.retries)
    this.retries += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  /** 当前是否连着。界面据此决定要不要退回轮询 */
  get connected() {
    return this.ws?.readyState === WebSocket.OPEN
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
