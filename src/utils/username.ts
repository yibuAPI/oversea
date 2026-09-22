/**
 * 用户名输入约束。注册和「账号设置 → 用户名」共用同一套规则，
 * 避免两处各写一份正则后慢慢跑偏。
 *
 * 允许：字母（含大小写）、数字、下划线。
 * 禁止：空格、连字符、点号等一切特殊符号，以及中文、表情等非 ASCII 字符。
 *       表情是代理对（surrogate pair），用 u 标志的字符类天然拦掉，
 *       不会像 `[\w]` 那样按半个代理位放行。
 * 上限：18 位，按字符数算（此处所有允许字符都是单码点，等价于 string.length）。
 */

export const USERNAME_MAX = 18

/** 整体校验用。只做判定，不做截断 */
export const USERNAME_RE = /^[A-Za-z0-9_]+$/

export function isValidUsername(value: string): boolean {
  return value.length > 0 && value.length <= USERNAME_MAX && USERNAME_RE.test(value)
}

/**
 * 就地剔除非法字符并截到上限。
 *
 * 只用于**输入过程**的净化（键入、粘贴、输入法上屏），不用于提交前的静默裁剪 ——
 * 提交路径上要么原样送出，要么由 isValidUsername 拦下报错，
 * 否则「用户以为填了中文，实际被悄悄删掉」这种错误没人说得清。
 */
export function sanitizeUsername(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/gu, '').slice(0, USERNAME_MAX)
}
