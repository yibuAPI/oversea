<script setup lang="ts">
/**
 * 接入文档。infron 的 Docs 页是「侧边小节 + 代码块 + 复制」的形态。
 *
 * 这一页没有专属后端接口 —— 内容是静态的，但**变量必须是真的**：
 *   base_url  固定展示 DOCS_BASE_URL（llmuni.com），不随后端 server_address 变化，
 *             否则用户复制走的代码会打到后端配置的旧域名（本地为 localhost）
 *   模型名     取 /api/user/models（用户真实可用的），不写死 gpt-4
 *   密钥       只提示去 API Keys 页取，绝不在文档里塞真实 key
 * 写死 base_url 是这类页面最常见的坑：用户复制走的代码直接打到示例域名。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import { Check, Copy, ExternalLink } from 'lucide-vue-next'
import { getMyModels } from '@/api/models'
import { DOCS_BASE_URL } from '@/utils/content-format'
import PageHeader from '@/components/ui/PageHeader.vue'

const { t } = useI18n()

const modelsQ = useQuery({ queryKey: ['my-models'], queryFn: () => getMyModels() })

/**
 * 基址。固定用 DOCS_BASE_URL，不随后端 server_address 变化——否则用户复制走的
 * 代码会打到后端配置的旧域名（本地为 localhost）。展示/复制时拼 /v1。
 */
const baseUrl = DOCS_BASE_URL

/** 示例里用的模型：优先用户真实可用的第一个 */
const sampleModel = computed(() => modelsQ.data.value?.[0] ?? 'gpt-4o-mini')

type Lang = 'curl' | 'python' | 'node' | 'openai-python'
const lang = ref<Lang>('curl')

const LANGS: { key: Lang; label: string }[] = [
  { key: 'curl', label: 'cURL' },
  { key: 'python', label: 'Python (requests)' },
  { key: 'openai-python', label: 'Python (openai)' },
  { key: 'node', label: 'Node.js' },
]

const snippets = computed<Record<Lang, string>>(() => {
  const base = baseUrl
  const model = sampleModel.value
  return {
    curl: `curl ${base}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ONESTEP_API_KEY" \\
  -d '{
    "model": "${model}",
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'`,

    python: `import os, requests

resp = requests.post(
    "${base}/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {os.environ['ONESTEP_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "model": "${model}",
        "messages": [{"role": "user", "content": "Hello!"}],
    },
    timeout=60,
)
resp.raise_for_status()
print(resp.json()["choices"][0]["message"]["content"])`,

    'openai-python': `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["ONESTEP_API_KEY"],
    base_url="${base}/v1",
)

completion = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(completion.choices[0].message.content)`,

    node: `import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.ONESTEP_API_KEY,
  baseURL: '${base}/v1',
})

const completion = await client.chat.completions.create({
  model: '${model}',
  messages: [{ role: 'user', content: 'Hello!' }],
})

console.log(completion.choices[0].message.content)`,
  }
})

const copied = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => clearTimeout(copyTimer))

async function copy(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = id
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = null), 1500)
  } catch {
    /* 剪贴板不可用（非 HTTPS 等）时静默，代码本身可见可选 */
  }
}

// ───────────────── 侧边目录 ─────────────────

const SECTIONS = [
  'quickstart',
  'auth',
  'endpoints',
  'streaming',
  'errors',
  'limits',
] as const
type Section = (typeof SECTIONS)[number]

const activeSection = ref<Section>('quickstart')

/** 滚动高亮当前小节。IntersectionObserver 比监听 scroll 省事且不抖 */
let observer: IntersectionObserver | undefined
onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      // 取最靠上的可见小节，避免两个同时可见时来回跳
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) activeSection.value = visible.target.id as Section
    },
    // 顶栏高 56，往下留一点余量再算「进入视野」
    { rootMargin: '-72px 0px -60% 0px' },
  )
  for (const s of SECTIONS) {
    const el = document.getElementById(s)
    if (el) observer.observe(el)
  }
})
onUnmounted(() => observer?.disconnect())

/** 常见错误码。取自后端 relay 层的实际返回，不是通用编造 */
const ERRORS = [
  { code: 401, key: 'unauthorized' },
  { code: 403, key: 'forbidden' },
  { code: 404, key: 'notFound' },
  { code: 429, key: 'rateLimited' },
  { code: 500, key: 'server' },
] as const

const ENDPOINTS = [
  { method: 'POST', path: '/v1/chat/completions', key: 'chat' },
  { method: 'POST', path: '/v1/embeddings', key: 'embeddings' },
  { method: 'POST', path: '/v1/images/generations', key: 'images' },
  { method: 'POST', path: '/v1/audio/speech', key: 'speech' },
  { method: 'POST', path: '/v1/audio/transcriptions', key: 'transcriptions' },
  { method: 'GET', path: '/v1/models', key: 'models' },
] as const
</script>

<template>
  <div>
    <PageHeader :title="t('docs.title')" :description="t('docs.subtitle')">
      <template #actions>
        <RouterLink
          to="/console/keys"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-btn-primary-bg px-3.5 text-[13px] font-medium text-btn-primary-fg transition-colors hover:bg-btn-primary-hover"
        >
          {{ t('docs.getKey') }}
        </RouterLink>
      </template>
    </PageHeader>

    <div class="flex gap-8">
      <!-- 内容 -->
      <div class="min-w-0 flex-1 space-y-10">
        <!-- 快速开始 -->
        <section id="quickstart" class="scroll-mt-20">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('docs.quickstart.title') }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {{ t('docs.quickstart.desc') }}
          </p>

          <!-- 基址：最常被复制错的一项，单独拎出来 -->
          <div class="mt-4 rounded-xl border border-border bg-bg-elevated p-4">
            <p class="text-[11.5px] uppercase tracking-wide text-fg-subtle">
              {{ t('docs.baseUrl') }}
            </p>
            <div class="mt-1.5 flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate font-mono text-[13px]">
                {{ baseUrl }}/v1
              </code>
              <button
                type="button"
                class="shrink-0 rounded-md border border-border p-1.5 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
                :aria-label="t('common.copy')"
                @click="copy(`${baseUrl}/v1`, 'base')"
              >
                <Check v-if="copied === 'base'" class="size-3.5 text-success-fg" />
                <Copy v-else class="size-3.5" />
              </button>
            </div>
          </div>

          <!-- 代码示例 -->
          <div class="mt-4 overflow-hidden rounded-xl border border-border bg-bg-elevated">
            <div class="flex items-center gap-1 border-b border-border bg-bg-subtle px-2">
              <button
                v-for="l in LANGS"
                :key="l.key"
                type="button"
                class="-mb-px border-b-2 px-2.5 py-2 text-[12px] transition-colors"
                :class="
                  lang === l.key
                    ? 'border-accent font-medium text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg'
                "
                @click="lang = l.key"
              >
                {{ l.label }}
              </button>
              <button
                type="button"
                class="ml-auto mr-1 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
                :aria-label="t('common.copy')"
                @click="copy(snippets[lang], 'snippet')"
              >
                <Check v-if="copied === 'snippet'" class="size-3.5 text-success-fg" />
                <Copy v-else class="size-3.5" />
              </button>
            </div>
            <pre
              class="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed"
            ><code>{{ snippets[lang] }}</code></pre>
          </div>

          <p class="mt-2 text-[12px] text-fg-subtle">
            {{ t('docs.modelNote', { model: sampleModel }) }}
          </p>
        </section>

        <!-- 鉴权 -->
        <section id="auth" class="scroll-mt-20">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('docs.auth.title') }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {{ t('docs.auth.desc') }}
          </p>
          <div class="mt-3 overflow-hidden rounded-xl border border-border bg-bg-elevated">
            <pre
              class="overflow-x-auto p-4 font-mono text-[12px]"
            ><code>Authorization: Bearer sk-xxxxxxxxxxxxxxxx</code></pre>
          </div>
          <div
            class="mt-3 rounded-xl border border-warning-border bg-warning-bg p-3 text-[12.5px] text-warning-fg"
          >
            {{ t('docs.auth.warning') }}
          </div>
        </section>

        <!-- 接口 -->
        <section id="endpoints" class="scroll-mt-20">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('docs.endpoints.title') }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {{ t('docs.endpoints.desc') }}
          </p>
          <div class="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-elevated">
            <div
              v-for="e in ENDPOINTS"
              :key="e.path"
              class="flex flex-wrap items-center gap-3 px-4 py-2.5"
            >
              <span
                class="w-11 shrink-0 rounded border border-border bg-bg-subtle px-1 py-0.5 text-center font-mono text-[10.5px] font-medium text-fg-muted"
              >
                {{ e.method }}
              </span>
              <code class="font-mono text-[12.5px]">{{ e.path }}</code>
              <span class="ml-auto text-[12px] text-fg-subtle">
                {{ t(`docs.endpoints.${e.key}`) }}
              </span>
            </div>
          </div>
        </section>

        <!-- 流式 -->
        <section id="streaming" class="scroll-mt-20">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('docs.streaming.title') }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {{ t('docs.streaming.desc') }}
          </p>
          <div class="mt-3 overflow-hidden rounded-xl border border-border bg-bg-elevated">
            <pre
              class="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed"
            ><code>{
  "model": "{{ sampleModel }}",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "stream": true
}</code></pre>
          </div>
        </section>

        <!-- 错误 -->
        <section id="errors" class="scroll-mt-20">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('docs.errors.title') }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {{ t('docs.errors.desc') }}
          </p>
          <div class="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-elevated">
            <div v-for="e in ERRORS" :key="e.code" class="flex gap-3 px-4 py-2.5">
              <span class="w-9 shrink-0 font-mono text-[12.5px] font-medium tabular">
                {{ e.code }}
              </span>
              <span class="text-[12.5px] text-fg-muted">
                {{ t(`docs.errors.${e.key}`) }}
              </span>
            </div>
          </div>
        </section>

        <!-- 限额 -->
        <section id="limits" class="scroll-mt-20">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('docs.limits.title') }}
          </h2>
          <p class="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {{ t('docs.limits.desc') }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <RouterLink
              to="/console/limits"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
            >
              {{ t('console.nav.quotaLimit') }}
              <ExternalLink class="size-3" />
            </RouterLink>
            <RouterLink
              to="/console/models"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
            >
              {{ t('console.nav.models') }}
              <ExternalLink class="size-3" />
            </RouterLink>
          </div>
        </section>
      </div>

      <!-- 侧边目录：窄屏藏掉，横向挤两列会很难看 -->
      <nav class="hidden w-[152px] shrink-0 xl:block" :aria-label="t('docs.toc')">
        <div class="sticky top-20">
          <p class="mb-2 text-[11px] uppercase tracking-wide text-fg-subtle">
            {{ t('docs.toc') }}
          </p>
          <ul class="space-y-0.5 border-l border-border">
            <li v-for="s in SECTIONS" :key="s">
              <a
                :href="`#${s}`"
                class="-ml-px block border-l-2 py-1 pl-3 text-[12.5px] transition-colors"
                :class="
                  activeSection === s
                    ? 'border-accent font-medium text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg'
                "
              >
                {{ t(`docs.${s}.title`) }}
              </a>
            </li>
          </ul>
        </div>
      </nav>
    </div>
  </div>
</template>
