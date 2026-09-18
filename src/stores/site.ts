import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import { getStatus, getNotice } from '@/api/auth'
import type { SiteStatus } from '@/api/types'

/** 回落默认值 —— 仅在后端未配置时使用。见 PLAN.md §1.6 */
export const DEFAULT_SYSTEM_NAME = 'llmuni'
export const DEFAULT_LOGO = '/logo.png'

/**
 * 站点配置。app 挂载前拉取一次，之后由 startNoticePolling 定时刷新，驱动：
 *   - 站名 / logo（管理员后台可改，前端无需重新构建）
 *   - 导航模块显隐、登录方式显隐、注册开关
 *   - 公告未读红点（见下方「公告自动刷新」）
 */
export const useSiteStore = defineStore('site', () => {
  const status = ref<SiteStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 系统公告（/api/notice → OptionMap["Notice"] 单条字符串），与 status 独立请求
  const notice = ref<string | null>(null)
  const noticeLoading = ref(false)
  const noticeError = ref<string | null>(null)

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

  /**
   * 对外可访问的 API 基址。后端管理台配的 server_address 优先 ——
   * 站点可能挂在反代/自定义域名后，此时 window.location.origin 未必是
   * 客户端该填的地址。未配置才回落到当前站点源。去掉末尾斜杠，
   * 便于调用方直接拼 `/v1` 之类的路径。
   */
  const serverAddress = computed(() => {
    const raw = status.value?.server_address
    const base =
      typeof raw === 'string' && raw.trim()
        ? raw.trim()
        : typeof window !== 'undefined'
          ? window.location.origin
          : ''
    return base.replace(/\/+$/, '')
  })

  /** 额度换算：后端以 quota 整数存储，展示需除以 quota_per_unit */
  const quotaPerUnit = computed(() => status.value?.quota_per_unit ?? 500_000)
  const displayInCurrency = computed(
    () => status.value?.display_in_currency !== false,
  )

  // ---------- 在线客服 ----------
  // 后端 console_setting.live_support_enabled 默认 false：没配就是没启用，
  // 前端据此决定挂不挂悬浮窗 —— 不给访客弹一个没人值守的客服窗。
  const liveSupportEnabled = computed(
    () => status.value?.live_support_enabled === true,
  )
  /** 后台留空时用 i18n 里的默认文案，见 SupportWidget 的 t() 调用 */
  const liveSupportTitle = computed(
    () => (status.value?.live_support_title || '').trim(),
  )
  const liveSupportWelcome = computed(
    () => (status.value?.live_support_welcome || '').trim(),
  )
  // 后端 defaultConsoleSetting 里是 false，所以这里要显式 true 才算开启，
  // 不能照 registerEnabled 的 !== false 写法（status 还没加载完会误判为开）。
  const ticketSystemEnabled = computed(
    () => status.value?.ticket_system_enabled === true,
  )

  /**
   * 拉取站点配置。silent 供定时轮询用：不动 loading/error，
   * 免得每次后台刷新都把依赖 loading 的骨架屏闪一遍。
   */
  async function load(options?: { silent?: boolean }) {
    const silent = options?.silent === true
    if (!silent) {
      loading.value = true
      error.value = null
    }
    try {
      status.value = await getStatus(silent ? { skipAuthHandler: true } : undefined)
      // 站名拉到后同步到文档标题
      if (typeof document !== 'undefined') {
        document.title = systemName.value
      }
    } catch (e) {
      // 轮询失败不写 error：页面上还挂着上一次的正常数据，弹错误反而把它顶掉
      if (!silent) error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (!silent) loading.value = false
    }
  }

  /**
   * 拉取系统公告（/api/notice）。与 status 相互独立：失败不影响站名/导航等。
   * silent 同 load()，供定时轮询用。
   */
  async function loadNotice(options?: { silent?: boolean }) {
    const silent = options?.silent === true
    if (!silent) {
      noticeLoading.value = true
      noticeError.value = null
    }
    try {
      notice.value = await getNotice(silent ? { skipAuthHandler: true } : undefined)
    } catch (e) {
      // 静默轮询失败就保留上一次的公告：清空会让面板里已经在看的公告凭空消失
      if (!silent) {
        notice.value = null
        noticeError.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      if (!silent) noticeLoading.value = false
    }
  }

  // ---------- 公告未读红点 ----------
  // 「有新公告」= 系统公告内容变了，或通知里出现比上次更晚的 publishDate。
  // 查看标记持久化到 localStorage，刷新后不重复亮红点；隐私模式下不可用则忽略。
  const UNREAD_STORAGE_KEY = 'onestep-notice-unread'

  interface NoticeUnreadState {
    /** 最近一次查看消息中心的时间（ms epoch），与通知 publishDate 比较判断是否更新 */
    seenAt: number
    /** 最近一次看过的系统公告内容，用于判断系统公告是否有新发布 */
    seenNotice: string
  }

  function readUnreadState(): NoticeUnreadState {
    try {
      const raw = localStorage.getItem(UNREAD_STORAGE_KEY)
      if (!raw) return { seenAt: 0, seenNotice: '' }
      const parsed = JSON.parse(raw) as Partial<NoticeUnreadState>
      return {
        seenAt: typeof parsed.seenAt === 'number' ? parsed.seenAt : 0,
        seenNotice: typeof parsed.seenNotice === 'string' ? parsed.seenNotice : '',
      }
    } catch {
      return { seenAt: 0, seenNotice: '' }
    }
  }

  const unreadState = ref<NoticeUnreadState>(readUnreadState())

  /** 通知里最新一条 publishDate（ms epoch），无有效值则为 0 */
  const latestAnnounceAt = computed(() => {
    const list = status.value?.announcements ?? []
    let latest = 0
    for (const a of list) {
      if (!a.publishDate) continue
      const ts = new Date(a.publishDate).getTime()
      if (Number.isFinite(ts) && ts > latest) latest = ts
    }
    return latest
  })

  /** 是否有未读公告：系统公告内容有更新，或通知晚于上次查看时间 */
  const hasNewNotice = computed(() => {
    const freshNotice =
      notice.value !== null &&
      notice.value.trim() !== '' &&
      notice.value !== unreadState.value.seenNotice
    const freshAnnounce = latestAnnounceAt.value > unreadState.value.seenAt
    return freshNotice || freshAnnounce
  })

  /** 打开消息中心即视为已读：记录当前最新公告的时间与内容，清除铃铛红点 */
  function markNoticeSeen() {
    unreadState.value = {
      // 水位只取 latestAnnounceAt，别掺 Date.now()：后台发通知时 publishDate
      // 常填当天零点甚至更早，掺了当前时间水位就高过新通知，红点再也不亮。
      seenAt: latestAnnounceAt.value,
      seenNotice: notice.value ?? '',
    }
    try {
      localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(unreadState.value))
    } catch {
      /* 隐私模式下 localStorage 不可用，忽略 */
    }
  }

  // ---------- 公告自动刷新 ----------
  // 公告只在 main.ts 启动时拉一次，之后没人再动它 —— 不刷新页面就永远等不到
  // 红点。后端没有推送端点（只有 /api/notice 与 /api/status 两个拉取接口），
  // 所以这里用定时轮询补上。
  const POLL_INTERVAL_MS = 90_000
  let pollTimer: ReturnType<typeof setInterval> | null = null

  /** 静默拉一遍两个公告源（status.announcements + notice） */
  function refreshNotices() {
    void load({ silent: true })
    void loadNotice({ silent: true })
  }

  function schedulePollTimer() {
    if (pollTimer !== null) return
    pollTimer = setInterval(refreshNotices, POLL_INTERVAL_MS)
  }

  function clearPollTimer() {
    if (pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  // 标签页切到后台就停表：浏览器会把不可见页面的定时器降频，攒下的请求还会在
  // 切回来的瞬间一起发出去。切回前台时立刻补一次，填上后台期间漏掉的更新。
  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      clearPollTimer()
      return
    }
    refreshNotices()
    schedulePollTimer()
  }

  /** 启动公告轮询。幂等 —— 重复调用不会叠加定时器 */
  function startNoticePolling() {
    if (typeof document === 'undefined') return
    schedulePollTimer()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  /** 停止轮询并摘掉监听器 */
  function stopNoticePolling() {
    clearPollTimer()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  // store 所在 scope 销毁时收尾（HMR、测试里重建 pinia 都会走到）
  onScopeDispose(stopNoticePolling)

  return {
    status,
    loading,
    error,
    notice,
    noticeLoading,
    noticeError,
    systemName,
    logo,
    registerEnabled,
    passwordLoginEnabled,
    emailVerification,
    turnstileEnabled,
    oauthProviders,
    hasNavModule,
    serverAddress,
    quotaPerUnit,
    displayInCurrency,
    liveSupportEnabled,
    liveSupportTitle,
    liveSupportWelcome,
    ticketSystemEnabled,
    load,
    loadNotice,
    hasNewNotice,
    markNoticeSeen,
    startNoticePolling,
    stopNoticePolling,
  }
})
