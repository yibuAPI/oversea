import { api } from './client'
import type {
  CreemProduct,
  Paginated,
  SubscriptionPlan,
  TopUpInfo,
  TopUpRecord,
  UserSubscription,
} from './types'

/**
 * 充值 / 支付 / 订阅。
 *
 * 这一组接口的 envelope 分两种，必须分开处理：
 *   - /topup/info、/topup/self、/topup  -> 标准 { success, message, data }
 *   - 其余支付网关接口                  -> { message: "success"|"error", data }
 * 后者走 api.pay()。
 */

export const getTopUpInfo = () => api.get<TopUpInfo>('/user/topup/info')

/** 充值/交易记录 */
export const listTopUps = (params: {
  keyword?: string
  p?: number
  page_size?: number
} = {}) => api.get<Paginated<TopUpRecord>>('/user/topup/self', { params })

/**
 * 兑换码充值，返回到账额度。
 * 后端故意不区分失败原因（无效/已用/过期都返回「兑换失败」），
 * 所以前端也别猜，原样透出 message 即可。
 */
export const redeemCode = (key: string) => api.post<number>('/user/topup', { key })

/** 试算价格，返回两位小数字符串 */
export const calcAmount = (amount: number) =>
  api.pay<string>('/user/amount', { amount }).then((r) => r.data)

/**
 * 易支付。返回的 data 是表单字段，需要前端构造 form POST 到 url ——
 * 不能直接 location.href 跳转。
 */
export const payEpay = (amount: number, paymentMethod: string) =>
  api.pay<Record<string, string>>('/user/pay', {
    amount,
    payment_method: paymentMethod,
  })

export const calcStripeAmount = (amount: number) =>
  api.pay<string>('/user/stripe/amount', { amount }).then((r) => r.data)

export const payStripe = (payload: {
  amount: number
  payment_method?: string
  success_url?: string
  cancel_url?: string
}) =>
  api
    .pay<{ pay_link: string }>('/user/stripe/pay', {
      payment_method: 'stripe',
      ...payload,
    })
    .then((r) => r.data)

export const payCreem = (productId: string) =>
  api
    .pay<{ checkout_url: string; order_id: string }>('/user/creem/pay', {
      product_id: productId,
      payment_method: 'creem',
    })
    .then((r) => r.data)

export const payUsdt = (amount: number) =>
  api
    .pay<{
      wallet_address: string
      usdt_amount: string
      trade_no: string
      expire_time: number
    }>('/user/usdt/pay', { amount })
    .then((r) => r.data)

export const getUsdtStatus = (tradeNo: string) =>
  api.pay<{ status: string }>('/user/usdt/status', { trade_no: tradeNo })

/**
 * creem_products 后端下发的是 JSON 字符串（实测），
 * 但类型上留了数组的可能，两种都兜住。
 */
export function parseCreemProducts(info: TopUpInfo | null): CreemProduct[] {
  const raw = info?.creem_products
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// ───────────────────────── 订阅 ─────────────────────────

/** 未开启支付合规确认时后端返回空数组 */
export const listSubscriptionPlans = () =>
  api
    .get<Array<{ plan: SubscriptionPlan }>>('/subscription/plans')
    .then((rows) => (rows ?? []).map((r) => r.plan))

export const getMySubscriptions = () =>
  api.get<{
    billing_preference: string
    subscriptions: Array<{ subscription: UserSubscription }>
    all_subscriptions: Array<{ subscription: UserSubscription }>
  }>('/subscription/self')

export const setBillingPreference = (billingPreference: string) =>
  api.put<{ billing_preference: string }>('/subscription/self/preference', {
    billing_preference: billingPreference,
  })

/** 余额购买订阅，走标准 envelope */
export const buyPlanWithBalance = (planId: number) =>
  api.post<null>('/subscription/balance/pay', { plan_id: planId })

export const buyPlanWithStripe = (planId: number) =>
  api
    .pay<{ pay_link: string }>('/subscription/stripe/pay', { plan_id: planId })
    .then((r) => r.data)

export const buyPlanWithCreem = (planId: number) =>
  api
    .pay<{ checkout_url: string; order_id: string }>('/subscription/creem/pay', {
      plan_id: planId,
    })
    .then((r) => r.data)
