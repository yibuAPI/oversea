<script setup lang="ts">
/**
 * 富文本渲染 —— 后台 about/content 富文本的通用渲染组件。
 *
 * 三种 mode：
 *   - markdown  用 marked 转 HTML，DOMPurify 消毒后渲染
 *   - html      后台直接下发的 HTML，DOMPurify 消毒后渲染（不二次转义）
 *   - text      非网页、非 HTML、非 Markdown 的纯文本（如整段聊天消息）
 *
 * 消毒是硬约束：后台 About/HomePageContent 等选项是管理员自由字符串，
 * 但前端仍可能被未授权访问，必须过滤 script / on* 事件 / javascript: 等。
 * 外链统一加 rel="noopener noreferrer"，防御 window.opener 劫持。
 */
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export interface RichContentProps {
  /** html：消毒后原样渲染；markdown/纯文本：先转 HTML */
  mode?: 'html' | 'markdown' | 'text'
  content: string
  className?: string
}

const props = withDefaults(defineProps<RichContentProps>(), {
  mode: 'markdown',
  className: '',
})

const renderedHtml = computed(() => {
  const raw = props.content ?? ''
  if (!raw) return ''

  let html: string
  if (props.mode === 'html') {
    html = raw
  } else {
    // marked 处理 text 也无害，但纯文本时用 escape 更省 —— 统一走 marked 更一致。
    // 后台富文本多用显式 <br> 分行的 markdown+HTML 混合体，breaks:true 会把换行
    // 也转成 <br>，导致 </br></br><br> 这类叠行，故关掉。
    html = marked.parse(raw, { breaks: false, async: false }) as string
  }

  // DOMPurify 默认只保留安全标签/属性，已足够；后台如需 SVG 图可后续放宽
  const sanitized = DOMPurify.sanitize(html)

  // 外链加 noopener
  const template = document.createElement('template')
  template.innerHTML = sanitized
  template.content.querySelectorAll('a[href]').forEach((link) => {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  })
  return template.innerHTML
})
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-html="renderedHtml" :class="['rich-content', 'prose', props.className]" />
</template>

<style scoped>
.rich-content :deep(h1),
.rich-content :deep(h2),
.rich-content :deep(h3),
.rich-content :deep(h4),
.rich-content :deep(h5),
.rich-content :deep(h6) {
  margin: 1.5em 0 0.6em;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.02em;
  color: var(--color-fg);
}
.rich-content :deep(h1) {
  font-size: 1.75em;
}
.rich-content :deep(h2) {
  font-size: 1.4em;
}
.rich-content :deep(h3) {
  font-size: 1.2em;
}
.rich-content :deep(p) {
  margin: 0.7em 0;
  font-size: 15px;
  line-height: 1.75;
  color: var(--color-fg-secondary);
}
.rich-content :deep(ul),
.rich-content :deep(ol) {
  margin: 0.8em 0;
  padding-left: 1.4em;
  color: var(--color-fg-secondary);
}
.rich-content :deep(li) {
  margin: 0.35em 0;
  line-height: 1.7;
}
.rich-content :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.rich-content :deep(blockquote) {
  margin: 1em 0;
  border-left: 3px solid var(--color-accent-border);
  background: var(--color-bg-muted);
  padding: 0.75em 1em;
  color: var(--color-fg-secondary);
}
.rich-content :deep(code) {
  border-radius: 0.25rem;
  background: var(--color-bg-muted);
  padding: 0.15em 0.4em;
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--color-fg);
}
.rich-content :deep(pre) {
  margin: 1em 0;
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-bg-muted);
  padding: 1em;
}
.rich-content :deep(pre code) {
  background: transparent;
  padding: 0;
}
.rich-content :deep(table) {
  margin: 1em 0;
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.rich-content :deep(th),
.rich-content :deep(td) {
  border: 1px solid var(--color-border);
  padding: 0.5em 0.75em;
  text-align: left;
}
.rich-content :deep(th) {
  background: var(--color-bg-muted);
  font-weight: 600;
}
.rich-content :deep(hr) {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--color-border);
}
.rich-content :deep(img) {
  max-width: 100%;
  border-radius: 0.5rem;
}
</style>
