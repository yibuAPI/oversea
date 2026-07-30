/**
 * 后端统一响应体。New API 全线接口均为此形状：
 *   { success: boolean, message: string, data?: T }
 * 部分列表接口 data 内再嵌 { items, total, page } 等分页字段。
 */
export interface ApiEnvelope<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

/**
 * 分页载荷（common.PageInfo）。实测四个字段恒定存在：
 *   { page: 1, page_size: 10, total: 0, items: [] }
 * 查询参数是 p / page_size（后端 fallback 还认 ps、size）。
 */
export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

/** 空分页，用于查询未就绪时的占位，省去到处判 undefined */
export function emptyPage<T>(): Paginated<T> {
  return { items: [], total: 0, page: 1, page_size: 0 }
}

/** 归一化后的业务错误 —— 拦截器抛出的都是此类型 */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  /** 429 时后端给出的重试秒数 */
  readonly retryAfter?: number
  readonly raw?: unknown

  constructor(
    message: string,
    opts: { status?: number; code?: string; retryAfter?: number; raw?: unknown } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = opts.status ?? 0
    this.code = opts.code
    this.retryAfter = opts.retryAfter
    this.raw = opts.raw
  }

  get isUnauthorized() {
    return this.status === 401
  }
  get isForbidden() {
    return this.status === 403
  }
  get isRateLimited() {
    return this.status === 429
  }
}

/** GET /api/status 的站点配置（仅列出用户端会用到的字段） */
export interface SiteStatus {
  system_name?: string
  logo?: string
  footer_html?: string
  top_up_link?: string
  chat_link?: string
  server_address?: string
  quota_per_unit?: number
  display_in_currency?: boolean
  email_verification?: boolean
  turnstile_check?: boolean
  turnstile_site_key?: string
  github_oauth?: boolean
  wechat_login?: boolean
  telegram_oauth?: boolean
  linuxdo_oauth?: boolean
  discord_oauth?: boolean
  oidc_enabled?: boolean
  passkey_enabled?: boolean
  register_enabled?: boolean
  password_login_enabled?: boolean
  password_register_enabled?: boolean
  setup?: boolean
  version?: string
  /** 顶部导航模块开关（pricing / rankings 等） */
  header_nav_modules?: string
  [k: string]: unknown
}

/** 当前登录用户 */
export interface SelfUser {
  id: number
  username: string
  display_name?: string
  role: number
  status: number
  email?: string
  group?: string
  quota: number
  used_quota: number
  request_count?: number
  aff_code?: string
  aff_count?: number
  aff_quota?: number
  github_id?: string
  wechat_id?: string
  telegram_id?: string
  linux_do_id?: string
  discord_id?: string
  oidc_id?: string
  setting?: string
  [k: string]: unknown
}

/** 角色常量（对应后端 common.RoleXxxUser） */
export const ROLE = {
  GUEST: 0,
  COMMON: 1,
  ENTERPRISE: 5,
  ADMIN: 10,
  ROOT: 100,
} as const

// ───────────────────────── API 密钥（令牌） ─────────────────────────

/**
 * model/token.go。字段以实测响应为准，与文档有两处不同：
 *   - allow_ips 实测返回 ""（空串）而非 null
 *   - 多一个 DeletedAt（gorm 软删除字段，前端不用）
 *
 * key 在列表/详情里是打码的（ps2c**********uqxZ），
 * 真实值只能通过 POST /api/token/:id/key 单独取。
 */
export interface ApiToken {
  id: number
  user_id: number
  key: string
  status: number
  name: string
  created_time: number
  accessed_time: number
  expired_time: number
  remain_quota: number
  unlimited_quota: boolean
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string | null
  used_quota: number
  group: string
  /** JSON 编码的 string[]，如 '["default"]' */
  groups: string
  cross_group_retry: boolean
}

/** 令牌状态（model/token.go 常量） */
export const TOKEN_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
  EXPIRED: 3,
  EXHAUSTED: 4,
} as const

export interface TokenPayload {
  name: string
  expired_time: number
  remain_quota: number
  unlimited_quota: boolean
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string | null
  cross_group_retry: boolean
  groups?: string[]
  group?: string
}

// ───────────────────────── 日志 ─────────────────────────

/** model/log.go。注意 JSON 键是 channel（Go 字段名 ChannelId） */
export interface LogEntry {
  id: number
  user_id: number
  created_at: number
  type: number
  content: string
  username: string
  token_name: string
  model_name: string
  quota: number
  prompt_tokens: number
  completion_tokens: number
  use_time: number
  is_stream: boolean
  channel: number
  channel_name: string
  token_id: number
  group: string
  ip: string
  request_id?: string
  upstream_request_id?: string
  /** JSON 串，含倍率、缓存 token 等明细 */
  other: string
}

export const LOG_TYPE = {
  ALL: 0,
  TOPUP: 1,
  CONSUME: 2,
  MANAGE: 3,
  SYSTEM: 4,
  ERROR: 5,
  REFUND: 6,
  LOGIN: 7,
} as const

export interface LogStat {
  quota: number
  rpm: number
  tpm: number
}

// ───────────────────────── 用量数据 ─────────────────────────

/**
 * GET /api/data/self —— 唯一带时间维度的接口。
 * created_at 按小时取整（created_at - created_at%3600），
 * 每行是 小时 × 模型 × 分组 × 令牌 × 渠道 的组合，需前端自行聚合。
 * 时间跨度硬上限 30 天。
 */
export interface QuotaDatum {
  id: number
  user_id: number
  username: string
  model_name: string
  created_at: number
  use_group: string
  token_id: number
  channel_id: number
  node_name: string
  token_used: number
  count: number
  quota: number
  cache_tokens: number
  cache_creation_tokens: number
}

/** GET /api/data/flow/self —— 无时间维度，按维度汇总 */
export interface FlowQuotaDatum {
  user_id?: number
  username?: string
  node_name?: string
  token_id?: number
  token_name?: string
  use_group: string
  channel_id?: number
  channel_name?: string
  model_name: string
  token_used: number
  cache_tokens: number
  cache_creation_tokens: number
  count: number
  quota: number
}

// ───────────────────────── 计费 ─────────────────────────

export interface TopUpRecord {
  id: number
  user_id: number
  amount: number
  quota: number
  money: number
  trade_no: string
  payment_method: string
  payment_provider: string
  create_time: number
  complete_time: number
  status: 'pending' | 'success' | 'failed' | 'expired'
}

export interface PayMethod {
  name: string
  type: string
  color: string
  /** 后端下发的是字符串 */
  min_topup: string
}

export interface CreemProduct {
  productId: string
  name: string
  price: number
  currency: string
  quota: number
  bonus?: number
}

/**
 * GET /api/user/topup/info。
 * 注意 creem_products 实测是 JSON 字符串而非数组，需二次 parse。
 */
export interface TopUpInfo {
  enable_online_topup: boolean
  enable_stripe_topup: boolean
  enable_creem_topup: boolean
  enable_waffo_topup: boolean
  enable_waffo_pancake_topup: boolean
  enable_usdt_topup: boolean
  enable_redemption: boolean
  payment_compliance_confirmed: boolean
  creem_products?: string | CreemProduct[]
  pay_methods?: PayMethod[] | null
  min_topup?: number
  stripe_min_topup?: number
  stripe_currency?: string
  usdt_min_topup?: number
  usdt_exchange_rate?: number
  amount_options?: number[]
  discount?: Record<string, number>
  topup_link?: string
  [k: string]: unknown
}

export interface SubscriptionPlan {
  id: number
  title: string
  subtitle: string
  price_amount: number
  currency: string
  duration_unit: string
  duration_value: number
  custom_seconds: number
  enabled: boolean
  sort_order: number
  allow_balance_pay: boolean | null
  allow_wallet_overflow: boolean | null
  stripe_price_id: string
  creem_product_id: string
  waffo_pancake_product_id: string
  max_purchase_per_user: number
  upgrade_group: string
  downgrade_group: string
  total_amount: number
  quota_reset_period: string
  quota_reset_custom_seconds: number
}

export interface UserSubscription {
  id: number
  user_id: number
  plan_id: number
  amount_total: number
  amount_used: number
  start_time: number
  end_time: number
  status: 'active' | 'expired' | 'cancelled'
  source: 'order' | 'admin'
  last_reset_time: number
  next_reset_time: number
  upgrade_group: string
  prev_user_group: string
  downgrade_group: string
  allow_wallet_overflow: boolean
}

// ───────────────────────── 模型与定价 ─────────────────────────

export interface PricingModel {
  model_name: string
  description?: string
  icon?: string
  tags?: string
  vendor_id?: number
  /** 0 = 按量（倍率），1 = 按次（固定价） */
  quota_type: number
  model_ratio: number
  model_price: number
  owner_by: string
  completion_ratio: number
  cache_ratio?: number
  create_cache_ratio?: number
  enable_groups: string[]
  supported_endpoint_types?: string[]
}

export interface Vendor {
  id: number
  name: string
  description?: string
  icon?: string
}

/** GET /api/pricing 是扁平响应：这些字段与 data 平级，不在 data 里 */
export interface PricingResponse {
  success: boolean
  data: PricingModel[]
  vendors: Vendor[]
  group_ratio: Record<string, number>
  usable_group: Record<string, string>
  supported_endpoint: Record<string, { path: string; method: string }>
  auto_groups: string[]
  pricing_version?: string
}

/** GET /api/user/groups：auto 分组的 ratio 是字符串 "自动" */
export interface UserGroup {
  ratio: number | string
  desc: string
}

// ───────────────────────── 异步任务 ─────────────────────────

export interface TaskEntry {
  id: number
  created_at: number
  updated_at: number
  task_id: string
  platform: string
  user_id: number
  group: string
  channel_id: number
  quota: number
  action: string
  status: string
  fail_reason: string
  result_url?: string
  submit_time: number
  start_time: number
  finish_time: number
  progress: string
  properties?: unknown
  data?: unknown
}

export interface MidjourneyEntry {
  id: number
  code: number
  user_id: number
  action: string
  mj_id: string
  prompt: string
  prompt_en: string
  description: string
  state: string
  submit_time: number
  start_time: number
  finish_time: number
  image_url: string
  video_url: string
  status: string
  progress: string
  fail_reason: string
  channel_id: number
  quota: number
}

// ───────────────────────── 账号安全 ─────────────────────────

export interface TwoFaStatus {
  enabled: boolean
  locked: boolean
  backup_codes_remaining?: number
}

export interface OAuthBinding {
  provider_id: number
  provider_name: string
  provider_slug: string
  provider_icon: string
  provider_user_id: string
}

/** dto/user_settings.go 中前端会改的部分 */
export interface UserSettingPayload {
  notify_type: 'email' | 'webhook' | 'bark' | 'gotify'
  quota_warning_threshold: number
  webhook_url?: string
  webhook_secret?: string
  notification_email?: string
  bark_url?: string
  gotify_url?: string
  gotify_token?: string
  gotify_priority?: number
  accept_unset_model_ratio_model: boolean
  record_ip_log: boolean
}
