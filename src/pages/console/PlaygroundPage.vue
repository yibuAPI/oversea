<script setup lang="ts">
/**
 * 操练场 —— 在线体验聊天模型。
 * 走后端 /pg 路由组（POST /pg/chat/completions，OpenAI 格式，SSE 流式）。
 * 该路由用 session cookie + New-Api-User 头鉴权（与 /api 一致），拒绝 access token；
 * 故这里用 fetch 直连（不经 axios 的 /api baseURL），并显式带 New-Api-User。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Bot,
  Send,
  Square,
  Eraser,
  Plus,
  MessageSquare,
  UserRound,
  Settings2,
  Pin,
  Cpu,
} from 'lucide-vue-next'
import { getMyModels, getMyGroups } from '@/api/models'
import { getCurrentUserId } from '@/api/client'

const { t } = useI18n()

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 是否正在流式生成（仅最后一帧用） */
  streaming?: boolean
  /** 生成失败标记 */
  error?: boolean
}

interface Session {
  id: number
  label: string
  messages: ChatMessage[]
}

const models = ref<string[]>([])
const model = ref('')
const groups = ref<Record<string, { ratio: number | string; desc: string }>>({})
const group = ref('')
const loadingModels = ref(false)
const loadingGroups = ref(false)

const sessions = ref<Session[]>([])
const nextId = ref(1)
const activeId = ref(0)

const messages = ref<ChatMessage[]>([])
const input = ref('')
const sending = ref(false)
const scrollEl = ref<HTMLElement | null>(null)

const tabs = ref<'model' | 'params' | 'stream'>('params')
const pinned = ref(false)

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

const modelOptions = computed(() => models.value)
const groupOptions = computed(() => Object.keys(groups.value))

const activeSession = computed(() => sessions.value.find((s) => s.id === activeId.value))

function newSession() {
  const id = nextId.value++
  sessions.value.unshift({ id, label: '', messages: [] })
  activeId.value = id
  messages.value = sessions.value[0].messages
}

function selectSession(id: number) {
  activeId.value = id
  const s = sessions.value.find((x) => x.id === id)
  messages.value = s ? s.messages : []
}

async function loadModels() {
  loadingModels.value = true
  try {
    const list = await getMyModels()
    models.value = list
    if (!model.value && list.length) model.value = list[0]
  } catch {
    /* 后端错误已在 axios 层转成提示，这里静默即可 */
  } finally {
    loadingModels.value = false
  }
}

async function loadGroups() {
  loadingGroups.value = true
  try {
    const map = await getMyGroups()
    groups.value = map
    if (!group.value && Object.keys(map).length) group.value = Object.keys(map)[0]
  } catch {
    /* 同上 */
  } finally {
    loadingGroups.value = false
  }
}

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

  try {
    const body: Record<string, unknown> = {
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

function clear() {
  messages.value = []
  input.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

onMounted(() => {
  void loadModels()
  void loadGroups()
})
</script>

<template>
  <div class="flex min-h-0 flex-1 -mx-4 -my-6 sm:-mx-6 lg:-mx-8">
    <div class="flex min-h-0 w-full overflow-hidden rounded-xl border border-border bg-bg-elevated">
      <!-- 左栏：会话列表 -->
      <aside
        class="flex w-full shrink-0 flex-col border-border bg-bg-subtle sm:w-60 lg:border-r"
      >
        <div class="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span class="text-[13px] font-medium text-fg">{{ t('console.playground.sessions') }}</span>
          <button
            type="button"
            class="motion-press inline-flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-muted hover:text-fg"
            :aria-label="t('console.playground.newSession')"
            @click="newSession"
          >
            <Plus class="size-4" />
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-2">
          <button
            v-for="s in sessions"
            :key="s.id"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px]"
            :class="
              s.id === activeId
                ? 'bg-accent text-fg-on-accent'
                : 'text-fg-muted hover:bg-bg-muted hover:text-fg'
            "
            @click="selectSession(s.id)"
          >
            <MessageSquare class="size-3.5 shrink-0" />
            <span class="truncate">{{ s.label || t('console.playground.unnamed') }}</span>
          </button>

          <p
            v-if="sessions.length === 0"
            class="px-2 py-4 text-center text-[12px] text-fg-subtle"
          >
            {{ t('console.playground.sessionEmpty') }}
          </p>
        </div>
      </aside>

      <!-- 中栏：对话 -->
      <section class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- 会话头部 -->
        <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div class="flex min-w-0 items-center gap-2 text-[13px] font-medium text-fg">
            <MessageSquare class="size-4 shrink-0 text-fg-muted" />
            <span class="truncate">{{ activeSession?.label || t('console.playground.sessions') }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="max-w-[180px] truncate text-[13px] text-fg-muted">{{ model || '—' }}</span>
            <button
              type="button"
              class="motion-press inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-muted hover:bg-bg-muted hover:text-fg"
              @click="clear"
            >
              <Eraser class="size-3.5" />
              {{ t('console.playground.clear') }}
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
              <Bot class="size-6 text-fg-muted" />
            </div>
            <p class="text-[14px] text-fg">
              {{ t('console.playground.empty', { model: model || '—' }) }}
            </p>
          </div>

          <div v-for="(m, i) in messages" :key="i" class="flex items-start gap-2.5">
            <div
              class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
              :class="m.role === 'user' ? 'bg-bg-inset text-fg-muted' : 'bg-accent text-fg-on-accent'"
            >
              <UserRound v-if="m.role === 'user'" class="size-3.5" />
              <Bot v-else class="size-3.5" />
            </div>
            <div
              class="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[14px] leading-relaxed"
              :class="m.role === 'user' ? 'bg-bg-muted text-fg' : 'bg-bg-subtle text-fg'"
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
          <div class="flex items-center gap-2">
            <textarea
              v-model="input"
              rows="2"
              class="min-h-[44px] flex-1 resize-none rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[14px] text-fg outline-none placeholder:text-fg-subtle focus:border-border-strong"
              :placeholder="t('console.playground.placeholder')"
              @keydown="onKeydown"
            ></textarea>
            <button
              v-if="sending"
              type="button"
              class="motion-press inline-flex h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-3 text-[13px] font-medium text-fg-muted hover:border-danger hover:text-danger"
              @click="stop"
            >
              <Square class="size-3.5" />
              {{ t('console.playground.stop') }}
            </button>
            <button
              v-else
              type="button"
              class="motion-press inline-flex h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-fg-on-accent"
              :disabled="!canSend()"
              @click="send"
            >
              <Send class="size-3.5" />
              {{ t('console.playground.send') }}
            </button>
          </div>
          <p class="mt-2 text-[12px] text-fg-subtle">
            {{ t('console.playground.shortcuts') }}
          </p>
        </div>
      </section>

      <!-- 右栏：云端配置 -->
      <aside class="hidden shrink-0 flex-col border-border bg-bg-subtle md:flex md:w-72 lg:border-l">
        <div class="flex items-center justify-between border-b border-border px-3 py-2.5">
          <span class="flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <Settings2 class="size-4 text-fg-muted" />
            {{ t('console.playground.cloudConfig') }}
          </span>
          <button
            type="button"
            class="motion-press inline-flex size-6 items-center justify-center rounded-md text-fg-subtle hover:bg-bg-muted hover:text-fg"
            :aria-label="t('console.playground.pin')"
            :class="pinned ? 'text-accent' : ''"
            @click="pinned = !pinned"
          >
            <Pin class="size-4" />
          </button>
        </div>

        <!-- 标签 -->
        <div class="flex border-b border-border">
          <button
            v-for="tab in (['model', 'params', 'stream'] as const)"
            :key="tab"
            type="button"
            class="flex-1 border-b-2 px-2 py-2 text-[13px] transition-colors"
            :class="
              tabs === tab
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-subtle hover:text-fg'
            "
            @click="tabs = tab"
          >
            {{ tab === 'model' ? t('console.playground.tabModel') : tab === 'params' ? t('console.playground.tabParams') : t('console.playground.tabStream') }}
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <!-- 模型 -->
          <div v-if="tabs === 'model'" class="space-y-3">
            <label class="block text-[12px] font-medium text-fg-muted" for="pg-model">
              {{ t('console.playground.model') }}
            </label>
            <select
              id="pg-model"
              v-model="model"
              class="mt-1.5 w-full rounded-lg border border-border bg-bg-subtle px-2.5 py-2 text-[13px] text-fg outline-none focus:border-border-strong"
              :disabled="loadingModels || modelOptions.length === 0"
            >
              <option v-if="loadingModels" value="">{{ t('console.playground.loading') }}</option>
              <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
            </select>

            <label class="mt-4 block text-[12px] font-medium text-fg-muted" for="pg-group">
              {{ t('console.playground.group') }}
            </label>
            <select
              id="pg-group"
              v-model="group"
              class="mt-1.5 w-full rounded-lg border border-border bg-bg-subtle px-2.5 py-2 text-[13px] text-fg outline-none focus:border-border-strong"
              :disabled="loadingGroups || groupOptions.length === 0"
            >
              <option v-if="loadingGroups" value="">{{ t('console.playground.loading') }}</option>
              <option v-for="g in groupOptions" :key="g" :value="g">{{ g }}</option>
            </select>

            <p class="mt-3 text-[12px] leading-relaxed text-fg-subtle">{{ t('console.playground.hint') }}</p>
          </div>

          <!-- 参数 -->
          <div v-else-if="tabs === 'params'" class="space-y-4">
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
                class="mt-1 w-full accent-[#005eff]"
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
                class="mt-1 w-full accent-[#005eff]"
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
                class="mt-1 w-full accent-[#005eff]"
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
                class="mt-1 w-full accent-[#005eff]"
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
          </div>

          <!-- 流式 -->
          <div v-else class="space-y-3">
            <label class="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2.5">
              <span class="flex items-center gap-2 text-[13px] text-fg">
                <Cpu class="size-4 text-fg-muted" />
                {{ t('console.playground.stream') }}
              </span>
              <input v-model="params.stream" type="checkbox" class="size-4 accent-[#005eff]" />
            </label>
            <p class="text-[12px] text-fg-subtle">{{ t('console.playground.streamDesc') }}</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
