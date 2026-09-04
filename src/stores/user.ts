import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getSelf, login as loginApi, logout as logoutApi } from '@/api/auth'
import { setCurrentUserId } from '@/api/client'
import { ROLE, type SelfUser } from '@/api/types'

/**
 * 当前登录用户。
 * 登录态本体是后端 session cookie，此 store 只是其在前端的镜像 ——
 * 故刷新页面后必须重新 fetchSelf()，不能只靠 localStorage。
 */
export const useUserStore = defineStore('user', () => {
  const user = ref<SelfUser | null>(null)
  const loading = ref(false)
  /** 是否已尝试过拉取（区分「未登录」与「尚未确认」） */
  const resolved = ref(false)

  const isLoggedIn = computed(() => user.value != null)
  const isAdmin = computed((): boolean => (user.value?.role ?? 0) >= ROLE.ADMIN)
  const isRoot = computed((): boolean => (user.value?.role ?? 0) >= ROLE.ROOT)

  /** 剩余额度（原始整数） */
  const quota = computed(() => user.value?.quota ?? 0)
  const usedQuota = computed(() => user.value?.used_quota ?? 0)

  function setUser(u: SelfUser | null) {
    user.value = u
    setCurrentUserId(u?.id ?? null)
  }

  async function fetchSelf() {
    loading.value = true
    try {
      setUser(await getSelf())
    } catch {
      // 401 属预期情况（未登录），静默置空
      setUser(null)
    } finally {
      loading.value = false
      resolved.value = true
    }
  }

  /** 确保登录态已确认过一次，供路由守卫调用 */
  async function ensureResolved() {
    if (!resolved.value) await fetchSelf()
    return user.value
  }

  /**
   * 登录。
   *
   * ⚠️ POST /api/user/login 返回的是**精简**用户对象（id/username/role/status...），
   * 不含 quota / used_quota —— 只有 GET /api/user/self 才带。若直接拿它当完整
   * SelfUser 存下来，侧边栏与总览的余额会一直是 $0.0000，直到用户手动刷新页面
   * （刷新时路由守卫走 ensureResolved -> fetchSelf 才补上）。
   * 故登录后必须再拉一次 self 补全。
   */
  async function login(username: string, password: string) {
    const u = await loginApi({ username, password })
    // 先落 uid：/user/self 需要 New-Api-User 头，否则 401
    setUser(u)
    resolved.value = true
    try {
      setUser(await getSelf())
    } catch {
      // 补全失败不影响登录本身，保留精简态即可
    }
    return user.value ?? u
  }

  async function logout() {
    try {
      await logoutApi()
    } finally {
      setUser(null)
      resolved.value = true
    }
  }

  /** 401 拦截器回调：仅清本地态，跳转交给路由层 */
  function clear() {
    setUser(null)
    resolved.value = true
  }

  return {
    user,
    loading,
    resolved,
    isLoggedIn,
    isAdmin,
    isRoot,
    quota,
    usedQuota,
    fetchSelf,
    ensureResolved,
    login,
    logout,
    clear,
  }
})
