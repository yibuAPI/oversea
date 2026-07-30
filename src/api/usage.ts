import { api } from './client'
import type {
  FlowQuotaDatum,
  LogEntry,
  LogStat,
  MidjourneyEntry,
  Paginated,
  QuotaDatum,
  TaskEntry,
} from './types'

/** 后端硬上限：时间跨度不能超过 30 天（controller/data.go） */
export const MAX_RANGE_SECONDS = 2_592_000

export interface LogQuery {
  p?: number
  page_size?: number
  /** 0 = 全部；见 LOG_TYPE */
  type?: number
  start_timestamp?: number
  end_timestamp?: number
  token_name?: string
  model_name?: string
  group?: string
  request_id?: string
  upstream_request_id?: string
}

export const listLogs = (params: LogQuery = {}) =>
  api.get<Paginated<LogEntry>>('/log/self', { params })

/**
 * 汇总统计。比 listLogs 多支持 channel 过滤，但不支持 request_id。
 * rpm/tpm 是后端按最近一分钟算的即时值，与时间窗无关。
 */
export const getLogStat = (
  params: Omit<LogQuery, 'p' | 'page_size' | 'request_id' | 'upstream_request_id'> & {
    channel?: number
  } = {},
) => api.get<LogStat>('/log/self/stat', { params })

/**
 * 唯一带时间维度的用量接口，按小时分桶。
 * 返回的是 小时×模型×分组×令牌×渠道 的明细行，画图前需自行聚合。
 */
export const getQuotaData = (startTimestamp: number, endTimestamp: number) =>
  api.get<QuotaDatum[]>('/data/self', {
    params: { start_timestamp: startTimestamp, end_timestamp: endTimestamp },
  })

/** 按维度汇总（无时间轴）。start/end 都必填且必须 > 0 */
export const getFlowQuotaData = (startTimestamp: number, endTimestamp: number) =>
  api.get<FlowQuotaDatum[]>('/data/flow/self', {
    params: { start_timestamp: startTimestamp, end_timestamp: endTimestamp },
  })

export interface TaskQuery {
  p?: number
  page_size?: number
  platform?: string
  task_id?: string
  status?: string
  action?: string
  model_name?: string
  start_timestamp?: number
  end_timestamp?: number
}

export const listTasks = (params: TaskQuery = {}) =>
  api.get<Paginated<TaskEntry>>('/task/self', { params })

export const getTaskStat = (params: TaskQuery = {}) =>
  api.get<{ quota: number }>('/task/self/stat', { params })

/** Midjourney 绘图记录。注意时间戳参数后端按字符串读 */
export const listMidjourney = (params: {
  p?: number
  page_size?: number
  mj_id?: string
  start_timestamp?: string
  end_timestamp?: string
} = {}) => api.get<Paginated<MidjourneyEntry>>('/mj/self', { params })
