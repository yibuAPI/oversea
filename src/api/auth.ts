import { api } from './client'
import type { SiteStatus, SelfUser } from './types'

/** 站点配置 —— 站名、logo、登录方式、模块开关等全部来自此接口 */
export const getStatus = () => api.get<SiteStatus>('/status')

/** 首次部署引导状态 */
export const getSetup = () => api.get<{ status: boolean; root_init: boolean }>('/setup')

export const getNotice = () => api.get<string>('/notice')
export const getAbout = () => api.get<string>('/about')
export const getHomePageContent = () => api.get<string>('/home_page_content')

/** 当前登录用户 */
export const getSelf = () => api.get<SelfUser>('/user/self')

export interface LoginPayload {
  username: string
  password: string
}
export const login = (payload: LoginPayload) =>
  api.post<SelfUser>('/user/login', payload)

export const logout = () => api.get<null>('/user/logout')

export const register = (payload: {
  username: string
  password: string
  email?: string
  verification_code?: string
  aff_code?: string
}) => api.post<null>('/user/register', payload)
