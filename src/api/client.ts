import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios'
import { ApiError, type ApiEnvelope } from './types'

/**
 * 全站唯一的 HTTP 客户端。
 *
 * 三条硬约束（来自后端实现，不可更改）：
 * 1. withCredentials 必须为 true —— 登录态是 gin session cookie。
 * 2. 开发期必须经 Vite proxy 同源访问 —— `/api` 路由组未挂全局 CORS，
 *    且 cookie 为 SameSite=Strict，跨源直连必失败。
 * 3. 响应体统一为 { success, message, data }，success=false 时 HTTP 仍可能是 200，
 *    故必须在拦截器里转成 reject，否则业务层会把失败当成功。
 */

/** 401 时由外部注入（避免 api 层依赖 store / router，防循环引用） */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

/**
 * middleware.UserAuth() 强制要求 New-Api-User 头，且其值必须与 session 里的
 * 用户 id 完全一致（middleware/auth.go:120-144），否则 401：
 *   缺失   -> "Unauthorized, New-Api-User header not provided"
 *   不匹配 -> id mismatch
 *
 * 这意味着「session cookie 有效」并不足以调通接口 —— 前端必须自己记住 uid。
 * 而 uid 只能从登录响应或 /api/user/self 拿到，于是形成死循环：
 * 刷新页面后内存态清空，fetchSelf() 不带头 -> 401 -> 永远恢复不了登录态。
 *
 * 故把 uid 落到 localStorage。它不是凭证（凭证仍是 HttpOnly cookie），
 * 被篡改也只会导致 mismatch 401，没有越权风险。
 */
const UID_KEY = 'yibuapi:uid'

function readStoredUid(): number | null {
  try {
    const raw = localStorage.getItem(UID_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null // 隐私模式下 localStorage 会抛
  }
}

let currentUserId: number | null = readStoredUid()

export function setCurrentUserId(id: number | null) {
  currentUserId = id
  try {
    if (id == null) localStorage.removeItem(UID_KEY)
    else localStorage.setItem(UID_KEY, String(id))
  } catch {
    /* 忽略：内存态已生效，只是不能跨刷新保持 */
  }
}

export function getCurrentUserId() {
  return currentUserId
}

export const http: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  withCredentials: true,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config) => {
  if (currentUserId != null) {
    config.headers.set?.('New-Api-User', String(currentUserId))
  }
  return config
})

http.interceptors.response.use(
  (res: AxiosResponse<ApiEnvelope>) => res,
  (error) => {
    // 网络层/HTTP 层错误
    const status = error?.response?.status ?? 0
    const payload = error?.response?.data as ApiEnvelope | undefined
    const message =
      payload?.message ||
      (status === 0 ? '网络连接失败，请检查后端服务是否运行' : error?.message) ||
      '请求失败'

    if (status === 401) onUnauthorized?.()

    const retryAfterRaw = error?.response?.headers?.['retry-after']
    const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : undefined

    return Promise.reject(
      new ApiError(message, {
        status,
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
        raw: payload,
      }),
    )
  },
)

/**
 * 解包 { success, message, data }。
 * success=false 一律抛 ApiError —— 业务层只需处理 data，无需各自判断 success。
 */
async function unwrap<T>(p: Promise<AxiosResponse<ApiEnvelope<T>>>): Promise<T> {
  const res = await p
  const body = res.data
  // 少数接口（如三方回调）直接返回裸数据，无 envelope
  if (body == null || typeof body !== 'object' || !('success' in body)) {
    return body as unknown as T
  }
  if (!body.success) {
    if (res.status === 401) onUnauthorized?.()
    throw new ApiError(body.message || '请求失败', {
      status: res.status,
      raw: body,
    })
  }
  return body.data as T
}

export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    unwrap<T>(http.get<ApiEnvelope<T>>(url, config)),
  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    unwrap<T>(http.post<ApiEnvelope<T>>(url, data, config)),
  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    unwrap<T>(http.put<ApiEnvelope<T>>(url, data, config)),
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    unwrap<T>(http.delete<ApiEnvelope<T>>(url, config)),
  /** 需要读取 message 的场景（如签到返回提示语） */
  raw: <T>(url: string, config?: AxiosRequestConfig) =>
    http.get<ApiEnvelope<T>>(url, config).then((r) => r.data),

  /**
   * 整个响应体（含 envelope）都要。用于 /api/pricing 这类
   * 把 vendors / group_ratio 等平铺在 data 旁边的扁平响应。
   */
  flat: <T>(url: string, config?: AxiosRequestConfig) =>
    http.get<T>(url, config).then((r) => r.data),

  /**
   * 支付类接口用的是另一套 envelope：{ message: "success"|"error", data }，
   * 完全没有 success 字段 —— 走上面的 unwrap 会把失败当成功。
   * 部分还在顶层附带 url（epay 需要前端 POST 过去）。
   */
  pay: async <T>(url: string, data?: unknown) => {
    const res = await http.post<{ message: string; data: T; url?: string }>(
      url,
      data,
    )
    const body = res.data
    if (body?.message !== 'success') {
      throw new ApiError(
        typeof body?.data === 'string' ? body.data : body?.message || '支付请求失败',
        { status: res.status, raw: body },
      )
    }
    return body
  },
}
