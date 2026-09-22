/**
 * 密码长度约束。注册页与「账号设置 → 修改密码」共用同一套规则。
 *
 * 数字对齐后端 model/user.go 的 `validate:"min=8,max=20"`：
 * 后端把 Password 和 Username 放在同一个 struct 上做 Validate.Struct，
 * 任一项越界都只回一句 `Field validation for 'Password' failed on the 'min' tag`，
 * 用户看不出是哪条规则、也看不出边界值。所以这两条必须在前端先拦下来。
 *
 * 只管长度：字符集不设限制（密码本就该允许特殊符号），后端也没有相应的 tag。
 */

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 20

export function isValidPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX
}
