import { api } from './client'
import type { ApiToken, Paginated, TokenPayload } from './types'

/**
 * API 密钥（后端叫「令牌」token）。
 * 整个 /api/token 组都是 UserAuth，服务端强制按 c.GetInt("id") 限定归属，
 * 前端无需（也无法）传 user_id。
 */

export interface TokenListParams {
  p?: number
  page_size?: number
}

export const listTokens = (params: TokenListParams = {}) =>
  api.get<Paginated<ApiToken>>('/token/', { params })

export const searchTokens = (params: {
  keyword?: string
  token?: string
  p?: number
  page_size?: number
}) => api.get<Paginated<ApiToken>>('/token/search', { params })

export const getToken = (id: number) => api.get<ApiToken>(`/token/${id}`)

/**
 * 创建令牌。注意后端 **不返回 data** —— 实测响应仅 { success, message }，
 * 故调用方创建后必须重新拉列表才能拿到新令牌。
 */
export const createToken = (payload: TokenPayload) =>
  api.post<null>('/token/', payload)

export const updateToken = (payload: TokenPayload & { id: number }) =>
  api.put<ApiToken>('/token/', payload)

/**
 * 只改状态（启用/禁用）。带上 status_only 后端会忽略其余所有字段，
 * 所以不必先 GET 一遍再回填。
 */
export const setTokenStatus = (id: number, status: number) =>
  api.put<ApiToken>('/token/?status_only=1', { id, status })

export const deleteToken = (id: number) => api.delete<null>(`/token/${id}`)

/** 批量删除，返回实际删除条数 */
export const deleteTokens = (ids: number[]) =>
  api.post<number>('/token/batch', { ids })

/**
 * 取明文密钥。列表接口里的 key 是打码的（MaskTokenKey），
 * 真实值只能走这个接口，且后端加了 CriticalRateLimit —— 不要批量轮询。
 * 返回的是裸 key，调用方自行拼 `sk-` 前缀。
 */
export const revealTokenKey = (id: number) =>
  api.post<{ key: string }>(`/token/${id}/key`)

/** 批量取明文密钥，后端上限 100 个 */
export const revealTokenKeys = (ids: number[]) =>
  api.post<{ keys: Record<number, string> }>('/token/batch/keys', { ids })

/** groups 字段是 JSON 字符串，解析失败时回落到 legacy 的 group */
export function parseTokenGroups(t: ApiToken): string[] {
  if (t.groups) {
    try {
      const arr = JSON.parse(t.groups)
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string')
    } catch {
      /* 落到下面的 group */
    }
  }
  return t.group ? [t.group] : []
}
