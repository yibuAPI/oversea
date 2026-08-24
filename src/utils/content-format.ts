/**
 * 富文本内容类型判定。
 *
 * 后台的 About / HomePageContent 等富文本选项是自由字符串，可能是：
 *   - 外链 URL（联系人表单页 / 在线客服 / 知识库）→ iframe 嵌入
 *   - 完整 HTML（二维码 + 本站须知等自定义版式）  → 消毒后渲染
 *   - 其余                                     → 按 Markdown 渲染
 * 渲染前先判型，决定走哪种通道。
 */

/** 是否 HTTP(S) 绝对地址 */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 是否更接近完整 HTML 片段（而非纯文本/纯 Markdown）。
 *
 * 只匹配文档级结构标记（doctype / html / head / body / style / script），
 * 不匹配裸标签（如 `<br>`、`<font>`）。后台富文本常是 Markdown 标题 + 内联
 * HTML 片段的混合体（如 `<br>`、`<font>`、`<img>`），若因一个 `<br>` 就判定为
 * HTML，会走「原始 HTML 消毒」通道，导致 `#` 标题不被转换、渲染成字面 `#` 文本。
 * 这类混合内容应走 Markdown 通道，由 marked 一并处理标题与内联 HTML。
 */
export function isLikelyHtml(value: string): boolean {
  return /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script[\s>]/i.test(
    value,
  )
}

/**
 * 接入文档展示的 base_url 固定值。
 * 文档页与密钥集成页展示/复制的接口基址统一用 llmuni.com，不随后端
 * server_address 变化——否则用户复制走的代码会打到后端配置的旧域名。
 */
export const DOCS_BASE_URL = 'https://llmuni.com'
