/**
 * 邀请码（?aff=）持久化。
 *
 * 为什么需要落盘：
 *   - 注册链接形如 /register?aff=xxxx，OAuth 登录跳转 /api/oauth/* 时会带上，
 *     但用户若在注册页点「去登录」、或走 401 拦截器被弹去 /login，
 *     当前 URL 的 ?aff= 就丢了，再回注册页无从找回。
 *   - 这里在全局守卫里把 hitURL 的 aff 同步到 localStorage，
 *     注册页读取时优先 URL，其次 localStorage，注册成功后清掉。
 */

const AFF_KEY = 'onestep:aff'

export function readAffCode(): string {
  try {
    return localStorage.getItem(AFF_KEY) ?? ''
  } catch {
    return ''
  }
}

export function persistAffCode(code: string | undefined) {
  if (!code) return
  try {
    localStorage.setItem(AFF_KEY, code)
  } catch {
    /* 隐私模式下 localStorage 会抛，忽略即可 */
  }
}

export function clearAffCode() {
  try {
    localStorage.removeItem(AFF_KEY)
  } catch {
    /* 同上 */
  }
}

/** 从当前路由 query 提取并落盘（原子操作，避免两处逻辑不同步） */
export function captureAffFromQuery(query: Record<string, unknown>) {
  const aff = typeof query.aff === 'string' ? query.aff : undefined
  persistAffCode(aff)
  return aff
}
