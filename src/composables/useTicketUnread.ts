import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useQuery } from '@tanstack/vue-query'
import { getMyTicketUnread } from '@/api/tickets'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'

/**
 * 用户侧未读工单数（GET /tickets/unread → CountTicketsUnreadForUser）。
 *
 * 这是 `['tickets-unread']` 这个 key 的**唯一**注册点。工单详情页与列表页在
 * 「打开详情（服务端清零）」「新建」「收到 WS 新消息」时都会 invalidate 它，
 * 但 invalidate 一个没有查询挂载的 key 是空操作 —— 所以必须有人真的订阅，
 * 否则后台回复后用户侧不会有任何提示（只能自己点进工单列表才看见）。
 *
 * 挂在常驻的控制台侧栏上，用户在控制台任何页面都能收到提示。
 *
 * 关掉工单系统或未登录时不发请求：后端 TicketSystemEnabled 中间件会直接拒绝，
 * 白打一个 60 秒一次的失败请求没有意义。api 层那边已带 skipAuthHandler，
 * 401 不会把人踢去登录页。
 */
export function useTicketUnread() {
  const site = useSiteStore()
  const user = useUserStore()
  const { ticketSystemEnabled } = storeToRefs(site)

  const query = useQuery({
    queryKey: ['tickets-unread'],
    queryFn: getMyTicketUnread,
    enabled: computed(() => ticketSystemEnabled.value && user.isLoggedIn),
    // 后端没有全局推送端点（WS 只按工单 id 分房间，不在详情页就收不到），
    // 所以侧栏红点只能轮询。60 秒是「够快」与「别刷接口」的折中；
    // refetchIntervalInBackground 保持默认 false，标签页切后台自动停表。
    refetchInterval: 60_000,
    // 全局默认关了窗口聚焦重取（main.ts），这里显式打开：
    // 切回标签页立刻补一次，不用干等一轮轮询。
    refetchOnWindowFocus: true,
    // 红点取不到不该弹错误提示，静默重试一次就够
    retry: 1,
  })

  /** 有未读回复的工单**条数**，不是消息条数 */
  const unread = computed(() => query.data.value?.unread ?? 0)

  return { unread }
}
