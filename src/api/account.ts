import { api } from './client'
import type { OAuthBinding, TwoFaStatus, UserSettingPayload } from './types'

/**
 * 账号设置。
 *
 * PUT /api/user/self 是「三态」接口 —— 后端按 key 存在性分派，
 * 且顺序是 sidebar_modules > language > 资料/密码，命中一个就返回。
 * 所以三类修改必须分开发请求，混在一个 body 里只有第一类生效。
 */

/** 改资料。改密码必须同时带 original_password */
export const updateProfile = (payload: {
  username?: string
  display_name?: string
  password?: string
  original_password?: string
}) => api.put<null>('/user/self', payload)

export const updateLanguage = (language: string) =>
  api.put<null>('/user/self', { language })

export const deleteSelf = () => api.delete<null>('/user/self')

/** 通知与偏好设置（独立接口，非上面那个三态接口） */
export const updateUserSetting = (payload: UserSettingPayload) =>
  api.put<null>('/user/setting', payload)

/**
 * 重新生成系统访问令牌。注意会**覆盖旧的**，
 * 调用后旧 token 立即失效，UI 上要提示清楚。
 */
export const regenerateAccessToken = () => api.get<string>('/user/token')

/** 邀请码，首次调用时后端惰性生成 */
export const getAffCode = () => api.get<string>('/user/aff')

/** 邀请收益转入可用额度 */
export const transferAffQuota = (quota: number) =>
  api.post<null>('/user/aff_transfer', { quota })

// ───────────────────────── 两步验证 ─────────────────────────

export const get2faStatus = () => api.get<TwoFaStatus>('/user/2fa/status')

export const setup2fa = () =>
  api.post<{ secret: string; qr_code_data: string; backup_codes: string[] }>(
    '/user/2fa/setup',
  )

export const enable2fa = (code: string) => api.post<null>('/user/2fa/enable', { code })

/** code 可以是 TOTP 也可以是备用码 */
export const disable2fa = (code: string) => api.post<null>('/user/2fa/disable', { code })

export const regenerateBackupCodes = (code: string) =>
  api.post<{ backup_codes: string[] }>('/user/2fa/backup_codes', { code })

// ───────────────────────── 第三方绑定 ─────────────────────────

export const listOAuthBindings = () => api.get<OAuthBinding[]>('/user/oauth/bindings')

export const unbindOAuth = (providerId: number) =>
  api.delete<null>(`/user/oauth/bindings/${providerId}`)

/** 已登录状态下再走一遍 OAuth 即为绑定流程 */
export const getOAuthState = (aff?: string) =>
  api.get<string>('/oauth/state', { params: aff ? { aff } : undefined })

export const bindEmail = (email: string, code: string) =>
  api.post<null>('/oauth/email/bind', { email, code })

/** 发送邮箱验证码。turnstile token 走 query 而非 body */
export const sendEmailCode = (email: string, turnstile?: string) =>
  api.get<null>('/verification', { params: { email, turnstile } })

// ───────────────────────── Passkey ─────────────────────────

export const getPasskey = () =>
  api.get<{ enabled: boolean; last_used_at?: number }>('/user/passkey')

export const deletePasskey = () => api.delete<null>('/user/passkey')

// ───────────────────────── 签到 ─────────────────────────

export interface CheckinInfo {
  enabled: boolean
  min_quota: number
  max_quota: number
  stats: {
    total_quota: number
    total_checkins: number
    checkin_count: number
    checked_in_today: boolean
    records: Array<{ checkin_date: string; quota_awarded: number }>
  }
}

/** month 格式 YYYY-MM，省略则当月 */
export const getCheckin = (month?: string) =>
  api.get<CheckinInfo>('/user/checkin', { params: month ? { month } : undefined })

export const doCheckin = () =>
  api.post<{ quota_awarded: number; checkin_date: string }>('/user/checkin')
