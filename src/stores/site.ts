import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getStatus } from '@/api/auth'
import type { SiteStatus } from '@/api/types'

/** 回落默认值 —— 仅在后端未配置时使用。见 PLAN.md §1.6 */
export const DEFAULT_SYSTEM_NAME = 'llmuni'
export const DEFAULT_LOGO = '/logo.png'

/**
 * 站点配置。app 挂载前拉取一次，驱动：
 *   - 站名 / logo（管理员后台可改，前端无需重新构建）
 *   - 导航模块显隐、登录方式显隐、注册开关
 */
export const useSiteStore = defineStore('site', () => {
  const status = ref<SiteStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 后端有值才用后端的，否则回落 —— 与现有 React 前端行为一致。
  // 对外品牌统一为 llmuni：后端 system_name 仍是旧值（New API 默认值 /
  // 旧中文名 / 旧服务名）时一律映射掉，避免后台没来得及改导致品牌外泄。
  // LEGACY_NAMES 里的每个值都是后端可能实际下发的字符串，未改别删。
  const LEGACY_NAMES = new Set(['newapi', 'yibuapi', '一步api'])
  const systemName = computed(() => {
    const raw = status.value?.system_name
    if (!raw || LEGACY_NAMES.has(raw.toLowerCase().replace(/[\s-_]/g, ''))) {
      return DEFAULT_SYSTEM_NAME
    }
    return raw
  })
  const logo = computed(() => status.value?.logo || DEFAULT_LOGO)

  const registerEnabled = computed(
    () => status.value?.register_enabled !== false,
  )
  const passwordLoginEnabled = computed(
    () => status.value?.password_login_enabled !== false,
  )
  const emailVerification = computed(
    () => status.value?.email_verification === true,
  )
  const turnstileEnabled = computed(
    () => status.value?.turnstile_check === true,
  )

  /** 已启用的第三方登录方式 */
  const oauthProviders = computed(() => {
    const s = status.value
    if (!s) return [] as string[]
    return (
      [
        ['github', s.github_oauth],
        ['discord', s.discord_oauth],
        ['linuxdo', s.linuxdo_oauth],
        ['oidc', s.oidc_enabled],
        ['wechat', s.wechat_login],
        ['telegram', s.telegram_oauth],
      ] as const
    )
      .filter(([, on]) => on === true)
      .map(([k]) => k)
  })

  /**
   * 顶部导航模块开关。后端 /api/status 下发 HeaderNavModules（JSON 字符串），
   * 语义与 admin 默认页面一致：**省略的键 = 开启**，只有显式关闭才隐藏
   * （后端 getHeaderNavAccess 的 fallback 也是 Enabled:true）。
   *   - 布尔 false / 0 / "false" / "0" → 关闭
   *   - 对象形态（如 pricing: { enabled, requireAuth }）→ 看 enabled 字段
   * 键名兼容两种：HeaderNavModules（JSON）+ header_nav_modules（逗号分隔兜底）。
   */
  const disabledNavModules = computed(() => {
    const raw = status.value?.HeaderNavModules ?? status.value?.header_nav_modules
    const disabled = new Set<string>()
    if (!raw) return disabled // 未配置，全开
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        for (const [key, v] of Object.entries(parsed)) {
          if (parseHeaderNavBool(v)) continue
          disabled.add(key)
        }
      } catch {
        /* 非法 JSON 视为未配置，全开 */
      }
      return disabled
    }
    if (typeof raw === 'string') {
      // 逗号分隔字符串形态：列出的是「启用」的模块，其余默认开启
      for (const key of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
        if (parseHeaderNavBool(key) === false) disabled.add(key)
      }
    }
    return disabled
  })
  function parseHeaderNavBool(value: unknown): boolean {
    if (value === true) return true
    if (value === false || value == null) return false
    if (typeof value === 'number') return value === 1
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase()
      return s === 'true' || s === '1'
    }
    // 对象形态（pricing: { enabled, requireAuth }）看 enabled 字段
    if (typeof value === 'object') {
      return parseHeaderNavBool((value as Record<string, unknown>).enabled)
    }
    return false
  }
  const hasNavModule = (name: string) => !disabledNavModules.value.has(name)

  /** 额度换算：后端以 quota 整数存储，展示需除以 quota_per_unit */
  const quotaPerUnit = computed(() => status.value?.quota_per_unit ?? 500_000)
  const displayInCurrency = computed(
    () => status.value?.display_in_currency !== false,
  )

  async function load() {
    loading.value = true
    error.value = null
    try {
      status.value = await getStatus()
      // 站名拉到后同步到文档标题
      if (typeof document !== 'undefined') {
        document.title = systemName.value
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  return {
    status,
    loading,
    error,
    systemName,
    logo,
    registerEnabled,
    passwordLoginEnabled,
    emailVerification,
    turnstileEnabled,
    oauthProviders,
    hasNavModule,
    quotaPerUnit,
    displayInCurrency,
    load,
  }
})
