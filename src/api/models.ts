import { api } from './client'
import type { PricingResponse, SummaryAllResult, UserGroup } from './types'

/**
 * 模型库与定价。
 *
 * /api/pricing 是**扁平响应** —— vendors / group_ratio / usable_group 等
 * 与 data 平级而非嵌在里面，故不能用 api.get（它只回 data），必须 api.flat。
 */
export const getPricing = () => api.flat<PricingResponse>('/pricing')

/** 当前用户可用的模型名列表；传 group 则只看该分组 */
export const getMyModels = (group?: string) =>
  api.get<string[]>('/user/models', { params: group ? { group } : undefined })

/** 所有模型的性能指标汇总：延迟 / 成功率 / 吞吐（公开，未登录也可访问） */
export const getPerfMetricsSummary = () =>
  api.get<SummaryAllResult>('/perf-metrics/summary')

/** 分组倍率与说明。auto 分组的 ratio 是字符串「自动」 */
export const getMyGroups = () => api.get<Record<string, UserGroup>>('/user/self/groups')

/**
 * 一个倍率 = 每百万 token 多少美元。
 * New API 的定价基准是 $2/M tokens 对应 ratio 1。
 */
export const RATIO_TO_USD_PER_MTOK = 2

/** 按量计费模型的输入价（美元/百万 token） */
export function inputPrice(modelRatio: number, groupRatio: number) {
  return modelRatio * groupRatio * RATIO_TO_USD_PER_MTOK
}

/** 输出价 = 输入价 × completion_ratio */
export function outputPrice(
  modelRatio: number,
  completionRatio: number,
  groupRatio: number,
) {
  return modelRatio * completionRatio * groupRatio * RATIO_TO_USD_PER_MTOK
}
