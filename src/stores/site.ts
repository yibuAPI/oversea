import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getStatus } from '@/api/auth'
import type { SiteStatus } from '@/api/types'

/** 回落默认值 —— 仅在后端未配置时使用。见 PLAN.md §1.6 */
export const DEFAULT_SYSTEM_NAME = 'OneStepAPI'
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
  // 对外品牌统一为 OneStepAPI：后端 system_name 仍是旧值（New API 默认值 /
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

  /** 顶部导航模块开关：后端以逗号分隔字符串下发 */
  const navModules = computed(() => {
    const raw = status.value?.header_nav_modules
    if (typeof raw !== 'string' || !raw) return null // null = 未配置，全开
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
  })
  const hasNavModule = (name: string) => {
    const m = navModules.value
    return m === null ? true : m.has(name)
  }

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
