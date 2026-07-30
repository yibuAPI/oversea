/**
 * 展示层格式化。
 *
 * 额度（quota）在后端是整数，换算关系：quota / quota_per_unit = 美元。
 * quota_per_unit 由 /api/status 下发（实测 500000），不要写死。
 */
import { i18n } from '@/i18n'

/** quota 整数 -> 美元数值 */
export function quotaToUsd(quota: number, quotaPerUnit: number): number {
  if (!quotaPerUnit) return 0
  return quota / quotaPerUnit
}

/**
 * 金额展示。小额自动加精度 —— $0.0003 不能显示成 $0.00，
 * 否则用户会以为没扣费。
 */
export function formatUsd(value: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(value)
  let digits = 2
  if (abs > 0 && abs < 0.01) digits = 6
  else if (abs < 1) digits = 4
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  const prefix = value < 0 ? '-' : opts.sign && value > 0 ? '+' : ''
  return `${prefix}$${body}`
}

export function formatQuota(
  quota: number,
  quotaPerUnit: number,
  opts?: { sign?: boolean },
): string {
  return formatUsd(quotaToUsd(quota, quotaPerUnit), opts)
}

/** 大数字缩写：1234567 -> 1.23M。token 数、请求数用 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 10_000 ? 2 : 1)}K`
  if (abs < 1_000_000_000) return `${(n / 1_000_000).toFixed(abs < 10_000_000 ? 2 : 1)}M`
  return `${(n / 1_000_000_000).toFixed(2)}B`
}

export function formatInt(n: number): string {
  return Math.round(n || 0).toLocaleString('en-US')
}

/** 百分比，入参是 0–1 的比例 */
export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return '0%'
  return `${(ratio * 100).toFixed(digits)}%`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** unix 秒 -> 本地 YYYY-MM-DD HH:mm:ss */
export function formatDateTime(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  const d = new Date(unixSeconds * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 图表轴用的短标签：同日显示时刻，跨日显示月日 */
export function formatAxisLabel(unixSeconds: number, hourly: boolean): string {
  const d = new Date(unixSeconds * 1000)
  return hourly
    ? `${pad(d.getHours())}:00`
    : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

/** 相对时间。「从未使用」这类空值交给调用方判断，这里只管有值的 */
export function formatRelative(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  const { t } = i18n.global
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return t('time.justNow')
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) })
  if (diff < 2592000) return t('time.daysAgo', { n: Math.floor(diff / 86400) })
  return formatDate(unixSeconds)
}

/** 耗时（秒）-> 人类可读 */
export function formatDuration(seconds: number): string {
  if (!seconds) return '—'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
