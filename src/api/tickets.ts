import { api } from './client'

/**
 * 工单（controller/ticket.go + model/ticket.go）。
 *
 * 两组接口、两套鉴权，路径前缀是唯一区别：
 *   /api/tickets/**        UserAuth，只能碰自己的工单
 *   /api/tickets/admin/**  AdminAuth，客服工作台
 *
 * 与 /token 组不同，工单接口**不走** Paginated<T>：
 * 列表返回 { tickets, total, counts }，分页参数是 page / page_size（page 从 1 起）。
 *
 * 内部备注（author_type='note'）与 internal=true 的事件只在管理侧下发，
 * 用户侧接口永远拿不到 —— 这条边界在服务端，前端无需（也不该）自行过滤。
 */

// ───────────────────────── 常量 ─────────────────────────

/** 状态机：pending → processing → awaiting → resolved → closed */
export const TICKET_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  AWAITING: 'awaiting',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
} as const

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS]

/** 有序状态列表，页签与筛选下拉按此顺序渲染 */
export const TICKET_STATUSES: TicketStatus[] = [
  TICKET_STATUS.PENDING,
  TICKET_STATUS.PROCESSING,
  TICKET_STATUS.AWAITING,
  TICKET_STATUS.RESOLVED,
  TICKET_STATUS.CLOSED,
]

export const TICKET_PRIORITY = {
  URGENT: 'urgent',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
} as const

export type TicketPriority = (typeof TICKET_PRIORITY)[keyof typeof TICKET_PRIORITY]

/** 由高到低，与后端 ORDER BY 的 CASE 排名一致 */
export const TICKET_PRIORITIES: TicketPriority[] = [
  TICKET_PRIORITY.URGENT,
  TICKET_PRIORITY.HIGH,
  TICKET_PRIORITY.NORMAL,
  TICKET_PRIORITY.LOW,
]

/**
 * 消息作者类型。note 是内部备注 —— 用户侧列表里永远不会出现，
 * 但类型仍要保留：同一套详情组件在管理侧要能渲染它。
 */
export const TICKET_AUTHOR = {
  USER: 'user',
  AGENT: 'agent',
  NOTE: 'note',
  SYSTEM: 'system',
} as const

export type TicketAuthorType = (typeof TICKET_AUTHOR)[keyof typeof TICKET_AUTHOR]

/** 时间线事件类型 */
export const TICKET_EVENT = {
  CREATED: 'created',
  STATUS: 'status',
  PRIORITY: 'priority',
  ASSIGN: 'assign',
  REPLY: 'reply',
  NOTE: 'note',
} as const

/** 问题类型（需求文档固定六项，值即 i18n 后缀） */
export const TICKET_CATEGORIES = [
  'api',
  'model',
  'topup',
  'billing',
  'account',
  'other',
] as const

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

/** 未分配。后端用 -1 表示「筛选未分配」，与 assignee_id=0（实际未分配）区分 */
export const ASSIGNEE_UNASSIGNED = -1

/** 只有 closed 锁定；resolved 仍可回复（回复后自动回到 processing） */
export const isTicketLocked = (status: string) => status === TICKET_STATUS.CLOSED

// ───────────────────────── 类型 ─────────────────────────

/**
 * 列表行与详情共用一个结构。冗余字段（last_message / message_count /
 * unread_for_* / last_actor / last_action）由后端在写入时同步维护，
 * 列表页因此不需要额外请求就能显示「最后一条消息」和红点。
 */
export interface Ticket {
  id: number
  user_id: number
  user_name: string
  user_account: string
  user_group: string
  title: string
  /** 自由文本的问题类型；当前前端与 category 同值 */
  type: string
  category: string
  status: TicketStatus
  priority: TicketPriority
  /** 0 = 未分配 */
  assignee_id: number
  assignee_name: string
  unread_for_agent: number
  unread_for_user: number
  last_message: string
  /** unix 秒 */
  last_message_at: number
  message_count: number
  last_actor: string
  last_action: string
  created_at: number
  updated_at: number
  /** 未解决时为 0 */
  resolved_at: number
  closed_at: number
}

export interface TicketMessage {
  id: number
  ticket_id: number
  author_type: TicketAuthorType
  author_id: number
  author_name: string
  /** 展示用角色，如「提交人」「技术支持」「内部备注」 */
  author_role: string
  content: string
  /** JSON 编码的 string[]（仅文件名），空则为 ""，用 parseAttachments 取 */
  attachments: string
  created_at: number
}

/**
 * 操作记录。text 是后端预渲染好的整句中文（如「将状态从 待处理 改为 处理中」），
 * 前端直接展示，不再拼装 —— 这样同一条历史在任何界面都读作同一句话。
 */
export interface TicketEvent {
  id: number
  ticket_id: number
  kind: string
  actor_id: number
  actor_name: string
  text: string
  /** true = 仅管理侧可见 */
  internal: boolean
  created_at: number
}

/** 五个状态恒定存在（后端预填零），故可直接下标取值 */
export type TicketStatusCounts = Record<TicketStatus, number>

export interface TicketListResult {
  tickets: Ticket[] | null
  total: number
  counts: TicketStatusCounts
}

export interface TicketDetailResult {
  ticket: Ticket
  messages: TicketMessage[] | null
  events: TicketEvent[] | null
}

export interface TicketReplyResult {
  message: TicketMessage
  ticket: Ticket
}

/** 列表未就绪时的占位，省去到处判 undefined */
export function emptyTicketList(): TicketListResult {
  return {
    tickets: [],
    total: 0,
    counts: {
      pending: 0,
      processing: 0,
      awaiting: 0,
      resolved: 0,
      closed: 0,
    },
  }
}

/**
 * 解析 attachments 字段。
 * 后端存的是 JSON 数组字符串，但历史数据或异常写入可能是空串甚至非数组，
 * 故这里全程兜底 —— 附件展示不该让整个详情页白屏。
 */
export function parseAttachments(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// ───────────────────────── 用户侧 ─────────────────────────

export interface TicketListParams {
  /** 从 1 起 */
  page?: number
  page_size?: number
  status?: string
  priority?: string
  category?: string
  keyword?: string
  /** created = 按创建时间；priority = 按优先级；其余 = 最近活跃 */
  order_by?: string
}

export const listMyTickets = (params: TicketListParams = {}) =>
  api.get<TicketListResult>('/tickets', { params })

export const getMyTicket = (id: number) =>
  api.get<TicketDetailResult>(`/tickets/${id}`)

export interface TicketCreatePayload {
  title: string
  type?: string
  category?: string
  priority?: TicketPriority
  content: string
  /** 仅文件名，后端会剥掉路径成分并截断到 6 个 */
  attachments?: string[]
}

/** 后端挂了 CriticalRateLimit，不要重试轰炸 */
export const createTicket = (payload: TicketCreatePayload) =>
  api.post<{ ticket: Ticket }>('/tickets', payload)

export const replyMyTicket = (
  id: number,
  payload: { content: string; attachments?: string[] },
) => api.post<TicketReplyResult>(`/tickets/${id}/messages`, payload)

/** 用户唯一能改状态的动作，且只能改成 closed。已关闭时幂等返回 */
export const closeMyTicket = (id: number) =>
  api.post<{ ticket: Ticket }>(`/tickets/${id}/close`)

/** 侧栏红点用。返回有未读回复的工单**条数**，不是消息数 */
export const getMyTicketUnread = () =>
  api.get<{ unread: number }>('/tickets/unread')

// ───────────────────────── 管理侧 ─────────────────────────

export interface AgentTicketListParams extends TicketListParams {
  /** 逗号分隔的多状态，如 'pending,processing'，用于「未完结」页签 */
  statuses?: string
  /** 只看有未读的，值必须是字符串 'true' */
  unread_only?: 'true'
  /** 'me' | 'none' | 数字 id */
  assignee?: string
}

export const listTicketsForAgent = (params: AgentTicketListParams = {}) =>
  api.get<TicketListResult>('/tickets/admin', { params })

export const getTicketForAgent = (id: number) =>
  api.get<TicketDetailResult>(`/tickets/admin/${id}`)

/** internal=true 写内部备注：不动状态、不动未读、用户看不到 */
export const replyTicketForAgent = (
  id: number,
  payload: { content: string; attachments?: string[]; internal?: boolean },
) => api.post<TicketReplyResult>(`/tickets/admin/${id}/messages`, payload)

export const setTicketStatus = (id: number, status: TicketStatus) =>
  api.put<{ ticket: Ticket }>(`/tickets/admin/${id}/status`, { status })

export const setTicketPriority = (id: number, priority: TicketPriority) =>
  api.put<{ ticket: Ticket }>(`/tickets/admin/${id}/priority`, { priority })

/** assignee_id=0 取消分配；非 0 时后端校验对方必须是管理员 */
export const assignTicket = (id: number, assigneeId: number) =>
  api.put<{ ticket: Ticket }>(`/tickets/admin/${id}/assignee`, {
    assignee_id: assigneeId,
  })

export const getTicketUnreadForAgent = () =>
  api.get<{ unread: number }>('/tickets/admin/unread')
