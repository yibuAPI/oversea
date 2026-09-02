<script setup lang="ts">
/**
 * 操练场 —— 在线体验聊天模型。
 * 走后端 /pg 路由组（POST /pg/chat/completions，OpenAI 格式，SSE 流式）。
 * 该路由用 session cookie + New-Api-User 头鉴权（与 /api 一致），拒绝 access token；
 * 故这里用 fetch 直连（不经 axios 的 /api baseURL），并显式带 New-Api-User。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSiteStore } from '@/stores/site'
import {
  ArrowUp,
  Square,
  Settings2,
  PanelRightOpen,
  PanelRightClose,
  Cpu,
  Check,
  ChevronDown,
  AlertTriangle,
  PenLine,
  Sparkles,
  Search,
} from 'lucide-vue-next'
import { getMyModels, getMyGroups } from '@/api/models'
import { getCurrentUserId } from '@/api/client'

const { t } = useI18n()
const { systemName, logo } = storeToRefs(useSiteStore())

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 是否正在流式生成（仅最后一帧用） */
  streaming?: boolean
  /** 生成失败标记 */
  error?: boolean
}

const models = ref<string[]>([])
const model = ref('')
const groups = ref<Record<string, { ratio: number | string; desc: string }>>({})
const group = ref('')
const loadingModels = ref(false)
const loadingGroups = ref(false)

const messages = ref<ChatMessage[]>([])
const input = ref('')
const sending = ref(false)
const scrollEl = ref<HTMLElement | null>(null)

/** 右侧「云端配置」栏是否展开，可整体收起 */
const configOpen = ref(true)

const params = ref({
  temperature: 1.0,
  topP: 1.0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  maxTokens: 1024,
  seed: '' as number | '',
  stream: true,
})

let controller: AbortController | null = null

function stop() {
  controller?.abort()
}

const groupOptions = computed(() => Object.keys(groups.value))

/** 底栏模型选择器的展开/收起，点击外部关闭 */
const bottomPanelOpen = ref(false)
const bottomPanelWrap = ref<HTMLElement | null>(null)
function bottomModelDocClick(e: MouseEvent) {
  const el = bottomPanelWrap.value
  if (!el || !el.contains(e.target as Node)) bottomPanelOpen.value = false
}

/** 自定义请求体模式：开启后用自定义 JSON 字段实时拼装请求体 */
const customBody = ref(false)
const customBodyJson = ref('')
const bodyValid = computed(() => {
  try {
    const o = JSON.parse(customBodyJson.value)
    return o && typeof o === 'object' && !Array.isArray(o)
  } catch {
    return false
  }
})
/** 由界面参数拼出可直接发送的请求体，供自定义模式初始化 */
function buildBodyJson() {
  const body: Record<string, unknown> = {
    model: model.value,
    messages: [],
    stream: params.value.stream,
  }
  if (group.value) body.group = group.value
  if (params.value.temperature != null) body.temperature = params.value.temperature
  if (params.value.topP != null) body.top_p = params.value.topP
  if (params.value.frequencyPenalty != null) body.frequency_penalty = params.value.frequencyPenalty
  if (params.value.presencePenalty != null) body.presence_penalty = params.value.presencePenalty
  if (params.value.maxTokens != null && params.value.maxTokens > 0)
    body.max_tokens = params.value.maxTokens
  if (params.value.seed !== '') body.seed = Number(params.value.seed)
  return JSON.stringify(body, null, 2)
}
watch(customBody, (on) => {
  if (on) customBodyJson.value = buildBodyJson()
  else customBodyJson.value = ''
})
function formatBody() {
  try {
    customBodyJson.value = JSON.stringify(JSON.parse(customBodyJson.value), null, 2)
  } catch {
    /* 保留原文，展示层已提示格式错误 */
  }
}

function onDocClick(e: MouseEvent) {
  bottomModelDocClick(e)
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

async function loadGroups() {
  loadingGroups.value = true
  try {
    const map = await getMyGroups()
    groups.value = map
  } catch {
    /* 同上 */
  } finally {
    loadingGroups.value = false
  }
}

/** 右栏模型列表的搜索关键字 */
const search = ref('')

/** 切换分组时重载该分组的模型；'' 表示加载全部分组 */
async function reloadModelsForGroup(g: string) {
  loadingModels.value = true
  try {
    const list = await getMyModels(g || undefined)
    models.value = list
    if (model.value && !list.includes(model.value)) model.value = ''
    if (!model.value && list.length) model.value = list[0]
  } catch {
    /* 后端错误已在 axios 层转成提示，这里静默即可 */
  } finally {
    loadingModels.value = false
  }
}

/** 切换分组：始终重载模型列表，保持与右栏「云端配置」的分组同步 */
function changeGroup(g: string) {
  group.value = g
  void reloadModelsForGroup(g)
}

/** 模型列表按关键字过滤（右栏） */
const modelOptions = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = models.value
  if (!q) return list
  return list.filter((m) => m.toLowerCase().includes(q))
})

function scrollToBottom() {
  nextTick(() => {
    const el = scrollEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(
  () => (messages.value.length ? messages.value[messages.value.length - 1].content : ''),
  scrollToBottom,
)

function canSend() {
  return !sending.value && input.value.trim() !== '' && model.value !== ''
}

async function send() {
  if (!canSend()) return
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  const assistant: ChatMessage = { role: 'assistant', content: '', streaming: true }
  messages.value.push(assistant)
  sending.value = true
  scrollToBottom()

  controller = new AbortController()

  let body: Record<string, unknown> | null = null
  // 自定义请求体模式：用自定义 JSON 字段，向 body 注入 messages 后发送
  if (customBody.value) {
    try {
      const parsed = JSON.parse(customBodyJson.value)
      body = {
        ...parsed,
        messages: messages.value
          .filter((m) => !m.error && !(m.streaming && m.content === ''))
          .map((m) => ({ role: m.role, content: m.content })),
      }
    } catch {
      body = null
      /* 预览与发送前都会校验，此处无需处理 */
    }
  }
  if (!body) {
    body = {
      model: model.value,
      messages: messages.value
        .filter((m) => !m.error && !(m.streaming && m.content === ''))
        .map((m) => ({ role: m.role, content: m.content })),
      stream: params.value.stream,
    }
    if (group.value) body.group = group.value
    if (params.value.temperature != null) body.temperature = params.value.temperature
    if (params.value.topP != null) body.top_p = params.value.topP
    if (params.value.frequencyPenalty != null)
      body.frequency_penalty = params.value.frequencyPenalty
    if (params.value.presencePenalty != null)
      body.presence_penalty = params.value.presencePenalty
    if (params.value.maxTokens != null && params.value.maxTokens > 0)
      body.max_tokens = params.value.maxTokens
    if (params.value.seed !== '') body.seed = Number(params.value.seed)
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const uid = getCurrentUserId()
    if (uid != null) headers['New-Api-User'] = String(uid)

    const res = await fetch('/pg/chat/completions', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `HTTP ${res.status}`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false

    while (!done) {
      const { value, done: d } = await reader.read()
      if (d) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.trimEnd()
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') {
          done = true
          break
        }
        try {
          const json = JSON.parse(payload)
          const delta = json?.choices?.[0]?.delta
          const piece = delta?.content ?? delta?.reasoning_content ?? ''
          if (piece) assistant.content += piece
        } catch {
          /* 忽略无法解析的心跳/非 JSON 行 */
        }
      }
      scrollToBottom()
    }
    assistant.streaming = false
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      assistant.streaming = false
    } else {
      assistant.streaming = false
      assistant.error = true
      assistant.content += `\n\n[${t('console.playground.errStream')}]`
      console.error(err)
    }
  } finally {
    sending.value = false
    controller = null
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

onMounted(() => {
  void loadGroups()
  void reloadModelsForGroup(group.value)
})
</script>

<template>
  <div class="flex min-h-0 flex-1 -mx-4 -my-6 sm:-mx-6 lg:-mx-8">
    <div class="flex min-h-0 w-full overflow-hidden rounded-xl bg-bg-elevated">
      <!-- 中栏：对话 -->
      <section class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- 会话头部 -->
        <div class="flex items-center justify-end border-b border-border px-4 py-2.5">
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="motion-press inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-muted hover:bg-bg-muted hover:text-fg"
              :aria-label="configOpen ? t('console.playground.hidePanel') : t('console.playground.showPanel')"
              @click="configOpen = !configOpen"
            >
              <PanelRightClose v-if="configOpen" class="size-3.5" />
              <PanelRightOpen v-else class="size-3.5" />
              {{ configOpen ? t('console.playground.hidePanel') : t('console.playground.showPanel') }}
            </button>
          </div>
        </div>

        <!-- 消息区 -->
        <div ref="scrollEl" class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div
            v-if="messages.length === 0"
            class="flex h-full flex-col items-center justify-center gap-3 text-center"
          >
            <div class="flex size-12 items-center justify-center rounded-full bg-bg-subtle">
              <img :src="logo" :alt="systemName" class="max-h-7 w-auto object-contain" />
            </div>
            <p class="text-[14px] text-fg">
              {{ t('console.playground.empty', { model: model || '—' }) }}
            </p>
          </div>

          <div
            v-for="(m, i) in messages"
            :key="i"
            class="flex items-start gap-2.5"
            :class="m.role === 'user' ? 'flex-row-reverse' : ''"
          >
            <div
              class="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed"
              :class="
                m.role === 'user'
                  ? 'bg-fg text-bg rounded-br-md'
                  : 'bg-bg-subtle text-fg rounded-bl-md'
              "
            >
              {{ m.content }}
              <span v-if="m.streaming && m.content === ''" class="text-fg-muted">
                {{ t('console.playground.thinking') }}
              </span>
              <span
                v-if="m.streaming && m.content"
                class="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-middle"
              />
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="border-t border-border p-3">
          <textarea
            v-model="input"
            rows="2"
            class="block min-h-[44px] w-full resize-none rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[14px] text-fg outline-none placeholder:text-fg-subtle focus:border-border-strong"
            :placeholder="t('console.playground.placeholder')"
            @keydown="onKeydown"
          ></textarea>
          <div class="mt-1.5 flex items-center justify-between gap-2">
            <!-- 左侧：模型选择器 -->
            <div ref="bottomPanelWrap" class="relative min-w-0">
              <button
                type="button"
                :aria-expanded="bottomPanelOpen"
                :aria-label="t('console.playground.model')"
                class="motion-press flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] text-fg outline-none hover:bg-bg-muted"
                :disabled="loadingModels || modelOptions.length === 0"
                @click="bottomPanelOpen = !bottomPanelOpen"
              >
                <Settings2 class="size-3.5 shrink-0 text-fg-muted" />
                <Sparkles class="size-3.5 shrink-0 text-accent" />
                <span class="truncate">{{ model || t('console.playground.loading') }}</span>
                <span
                  v-if="group"
                  class="shrink-0 rounded-sm border border-border bg-bg-muted px-1 py-px text-[11px] leading-none text-fg-muted"
                >
                  {{ group }}
                </span>
                <ChevronDown
                  class="size-3.5 shrink-0 text-fg-subtle transition-transform"
                  :class="bottomPanelOpen ? 'rotate-180' : ''"
                />
              </button>
              <div
                v-if="bottomPanelOpen"
                class="absolute bottom-full left-0 z-20 mb-1.5 flex w-[420px] max-h-[360px] overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg"
              >
                <!-- 左栏：模型分组 -->
                <div class="flex min-h-0 w-36 shrink-0 flex-col border-r border-border">
                  <div class="shrink-0 px-3 pt-2.5 pb-1 text-[11px] font-medium leading-none text-fg-subtle">
                    {{ t('console.playground.modelGroupList') }}
                  </div>
                  <div class="min-h-0 grow overflow-y-auto pb-1 pt-1">
                    <button
                      v-for="g in groupOptions"
                      :key="g"
                      type="button"
                      class="motion-press mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-fg-muted hover:bg-bg-muted hover:text-fg"
                      :class="group === g ? 'bg-bg-muted text-fg' : ''"
                      @click="changeGroup(g)"
                    >
                      <Check v-if="group === g" class="size-3.5 shrink-0 text-accent" />
                      <span v-else class="size-3.5 shrink-0" />
                      <span class="truncate">{{ g }}</span>
                    </button>
                  </div>
                </div>
                <!-- 右栏：模型列表（可搜索） -->
                <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div class="relative shrink-0 border-b border-border px-2 py-2">
                    <Search
                      class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
                    />
                    <input
                      v-model="search"
                      type="text"
                      class="block h-7 w-full rounded-lg border border-border bg-bg-inset pl-8 pr-2 text-[12px] text-fg outline-none placeholder:text-fg-subtle focus:border-border-selected"
                      :placeholder="t('console.playground.searchModel')"
                      @click.stop
                    />
                  </div>
                  <div class="min-h-0 grow overflow-y-auto py-1">
                    <button
                      v-for="m in modelOptions"
                      :key="m"
                      type="button"
                      class="motion-press mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-fg-muted hover:bg-bg-muted hover:text-fg"
                      :class="model === m ? 'bg-bg-muted text-fg' : ''"
                      @click="model = m; bottomPanelOpen = false; search = ''"
                    >
                      <Check v-if="model === m" class="size-3.5 shrink-0 text-accent" />
                      <span v-else class="size-3.5 shrink-0" />
                      <span class="truncate">{{ m }}</span>
                    </button>
                    <p
                      v-if="!modelOptions.length"
                      class="px-3 py-2 text-[12px] text-fg-subtle"
                    >
                      {{ loadingModels ? t('console.playground.loading') : t('console.playground.emptyModel') }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <!-- 右侧：快捷键提示 + 发送键 -->
            <div class="flex shrink-0 items-center gap-2">
              <p class="hidden text-[12px] text-fg-subtle sm:block">
                {{ t('console.playground.shortcuts') }}
              </p>
              <button
                v-if="sending"
                type="button"
                class="motion-press inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-bg-elevated text-fg-muted hover:border-danger hover:text-danger"
                :aria-label="t('console.playground.stop')"
                @click="stop"
              >
                <Square class="size-3.5" />
              </button>
              <button
                v-else
                type="button"
                class="motion-press inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-fg-on-accent disabled:opacity-40"
                :aria-label="t('console.playground.send')"
                :disabled="!canSend()"
                @click="send"
              >
                <ArrowUp class="size-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 右栏：云端配置 -->
      <aside
        class="hidden shrink-0 flex-col border-border bg-bg-subtle md:flex md:w-72"
        :class="configOpen ? '' : 'md:hidden'"
      >
        <div class="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span class="flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <Settings2 class="size-4 text-fg-muted" />
            {{ t('console.playground.cloudConfig') }}
          </span>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <div class="space-y-4">
            <p class="text-[12px] leading-relaxed text-fg-subtle">{{ t('console.playground.hint') }}</p>
          </div>

          <!-- 参数 -->
          <div class="mt-4 space-y-4">
            <div class="space-y-1.5">
              <label
                class="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2.5"
              >
                <span class="text-[13px] font-medium text-fg">{{ t('console.playground.customBodyMode') }}</span>
                <input v-model="customBody" type="checkbox" class="size-4 accent-[#000000] dark:accent-white" />
              </label>
              <p v-if="customBody" class="text-[11px] text-fg-subtle">
                {{ t('console.playground.customBodyModeDesc') }}
              </p>
            </div>

            <!-- 自定义请求体 JSON 编辑器 -->
            <div v-if="customBody" class="space-y-2">
              <div
                class="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-[12px] leading-relaxed text-warning-fg"
              >
                <AlertTriangle class="mt-0.5 size-4 shrink-0" />
                <span>{{ t('console.playground.customBodyWarn') }}</span>
              </div>

              <div class="flex items-center justify-between">
                <span class="text-[12px] font-medium text-fg">{{ t('console.playground.bodyLabel') }}</span>
                <span class="flex items-center gap-2 text-[11.5px]">
                  <span
                    v-if="bodyValid"
                    class="flex items-center gap-1 text-success-fg"
                  >
                    <Check class="size-3.5" />
                    {{ t('console.playground.bodyValid') }}
                  </span>
                  <span v-else class="flex items-center gap-1 text-danger-fg">
                    <AlertTriangle class="size-3.5" />
                    {{ t('console.playground.bodyInvalid') }}
                  </span>
                  <button
                    type="button"
                    class="flex items-center gap-1 text-fg-subtle transition-colors hover:text-fg"
                    @click="formatBody"
                  >
                    <PenLine class="size-3.5" />
                    {{ t('console.playground.bodyFormat') }}
                  </button>
                </span>
              </div>

              <textarea
                v-model="customBodyJson"
                rows="12"
                spellcheck="false"
                class="w-full resize-y rounded-lg border border-border bg-bg-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle focus:border-border-selected"
              ></textarea>
              <p class="text-[11px] text-fg-subtle">{{ t('console.playground.bodyHelp') }}</p>
            </div>

            <!-- 界面预设参数：自定义模式下置灰禁用 -->
            <div v-if="customBody" class="space-y-4 opacity-50 pointer-events-none select-none">
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.temperature') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.temperature.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="params.temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.temperatureDesc') }}</p>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.topP') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.topP.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="params.topP"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.topPDesc') }}</p>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.frequencyPenalty') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.frequencyPenalty.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="params.frequencyPenalty"
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.frequencyPenaltyDesc') }}</p>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.presencePenalty') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.presencePenalty.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="params.presencePenalty"
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.presencePenaltyDesc') }}</p>
              </div>

              <div>
                <label class="block text-[12px] font-medium text-fg" for="pg-max-tokens">
                  {{ t('console.playground.maxTokens') }}
                </label>
                <input
                  id="pg-max-tokens"
                  v-model.number="params.maxTokens"
                  type="number"
                  min="1"
                  class="mt-1 w-full rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-[13px] text-fg outline-none focus:border-border-strong"
                />
                <p class="mt-0.5 text-[11px] text-fg-subtle">{{ t('console.playground.maxTokensDesc') }}</p>
              </div>

              <div>
                <label class="block text-[12px] font-medium text-fg" for="pg-seed">
                  {{ t('console.playground.seed') }}
                </label>
                <input
                  id="pg-seed"
                  v-model="params.seed"
                  type="number"
                  placeholder="—"
                  class="mt-1 w-full rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-border-strong"
                />
                <p class="mt-0.5 text-[11px] text-fg-subtle">{{ t('console.playground.seedDesc') }}</p>
              </div>

              <!-- 流式输出：自定义模式下被忽略 -->
              <div class="space-y-1.5">
                <label
                  class="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2.5"
                >
                  <span class="flex items-center gap-2 text-[13px] text-fg">
                    <Cpu class="size-4 text-fg-muted" />
                    {{ t('console.playground.stream') }}
                    <span class="text-[11px] font-normal text-fg-subtle">
                      {{ t('console.playground.streamIgnored') }}
                    </span>
                  </span>
                  <input v-model="params.stream" type="checkbox" class="size-4 accent-[#000000] dark:accent-white" />
                </label>
                <p class="text-[12px] text-fg-subtle">{{ t('console.playground.streamDesc') }}</p>
              </div>
            </div>

            <!-- 界面预设参数：正常模式 -->
            <div v-else class="space-y-4">
              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.temperature') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.temperature.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="params.temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.temperatureDesc') }}</p>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.topP') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.topP.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="params.topP"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.topPDesc') }}</p>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.frequencyPenalty') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.frequencyPenalty.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="params.frequencyPenalty"
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.frequencyPenaltyDesc') }}</p>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <span class="text-[12px] font-medium text-fg">{{ t('console.playground.presencePenalty') }}</span>
                  <span class="tabular text-[12px] text-fg-muted">{{ params.presencePenalty.toFixed(1) }}</span>
                </div>
                <input
                  v-model.number="params.presencePenalty"
                  type="range"
                  min="-2"
                  max="2"
                  step="0.1"
                  class="mt-1 w-full accent-[#000000] dark:accent-white"
                />
                <p class="text-[11px] text-fg-subtle">{{ t('console.playground.presencePenaltyDesc') }}</p>
              </div>

              <div>
                <label class="block text-[12px] font-medium text-fg" for="pg-max-tokens">
                  {{ t('console.playground.maxTokens') }}
                </label>
                <input
                  id="pg-max-tokens"
                  v-model.number="params.maxTokens"
                  type="number"
                  min="1"
                  class="mt-1 w-full rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-[13px] text-fg outline-none focus:border-border-strong"
                />
                <p class="mt-0.5 text-[11px] text-fg-subtle">{{ t('console.playground.maxTokensDesc') }}</p>
              </div>

              <div>
                <label class="block text-[12px] font-medium text-fg" for="pg-seed">
                  {{ t('console.playground.seed') }}
                </label>
                <input
                  id="pg-seed"
                  v-model="params.seed"
                  type="number"
                  placeholder="—"
                  class="mt-1 w-full rounded-lg border border-border bg-bg-subtle px-2.5 py-1.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-border-strong"
                />
                <p class="mt-0.5 text-[11px] text-fg-subtle">{{ t('console.playground.seedDesc') }}</p>
              </div>

              <!-- 流式 -->
              <div class="space-y-1.5">
                <label
                  class="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2.5"
                >
                  <span class="flex items-center gap-2 text-[13px] text-fg">
                    <Cpu class="size-4 text-fg-muted" />
                    {{ t('console.playground.stream') }}
                  </span>
                  <input v-model="params.stream" type="checkbox" class="size-4 accent-[#000000] dark:accent-white" />
                </label>
                <p class="text-[12px] text-fg-subtle">{{ t('console.playground.streamDesc') }}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
