import { api } from './client'

/**
 * GET /api/rankings —— 公开接口，按真实调用量统计的模型/厂商热度。
 * 形状按 2026-07-30 对本地后端实测：标准信封，data 内含
 * models / vendors / top_movers / top_droppers / *_history。
 * history 目前前端未用（首版不画趋势图），类型先不建。
 */

export interface RankedModel {
  rank: number
  /** 上期名次；新上榜的没有此字段 */
  previous_rank?: number
  model_name: string
  vendor: string
  vendor_icon?: string
  category?: string
  total_tokens: number
  /** 0–1 的占比 */
  share: number
  growth_pct: number
}

export interface RankedVendor {
  rank: number
  vendor: string
  vendor_icon?: string
  total_tokens: number
  share: number
  growth_pct: number
  models_count: number
  top_model: string
}

export interface RankMover {
  model_name: string
  vendor: string
  vendor_icon?: string
  rank_delta: number
  current_rank: number
  growth_pct: number
}

export interface RankingsData {
  models: RankedModel[]
  vendors: RankedVendor[]
  top_movers: RankMover[]
  top_droppers: RankMover[]
}

export const getRankings = () => api.get<RankingsData>('/rankings')
