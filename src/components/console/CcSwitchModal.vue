<script setup lang="ts">
/**
 * 「填入 CC Switch」——把一个已存在的密钥导出成 CC Switch 客户端配置。
 *
 * CC Switch 是本地的 Claude Code / Codex / Gemini CLI 供应商切换工具，
 * 通过自定义协议 `ccswitch://v1/import?...` 接收配置。我们只负责把
 * 站点地址 + 明文密钥 + 用户选的模型拼成该 URL 并交给系统打开，
 * 没有任何网络请求 —— 装没装 CC Switch 浏览器都无法回报，故打开后
 * 只提示「已唤起」，不声称导入成功。
 *
 * endpoint 的差异是 CC Switch 的约定：Codex 走 OpenAI 兼容路径要带 /v1，
 * Claude / Gemini 用站点根地址（各自 SDK 自己补路径）。
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Check, Search } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'

const props = defineProps<{
  open: boolean
  /** 明文密钥，**不含** sk- 前缀（与 revealTokenKey 的返回一致） */
  tokenKey: string
  /** 密钥名称，用作配置名默认值的参考 */
  tokenName?: string
  /** 可选模型列表 */
  models: string[]
}>()

const emit = defineEmits<{ close: []; opened: [] }>()

const { t } = useI18n()
const site = useSiteStore()
const { serverAddress } = storeToRefs(site)

/**
 * 三个目标应用各自需要哪些模型字段。
 * Claude Code 支持给 haiku/sonnet/opus 三档分别指定模型（用于快慢档路由），
 * 另外两个只有主模型。字段 key 必须与 CC Switch 的 query 参数名一致。
 */
const APPS = [
  {
    key: 'claude',
    label: 'Claude',
    defaultName: 'My Claude',
    fields: [
      { key: 'model', labelKey: 'ccswitch.fModelMain', required: true },
      { key: 'haikuModel', labelKey: 'ccswitch.fModelHaiku', required: false },
      { key: 'sonnetModel', labelKey: 'ccswitch.fModelSonnet', required: false },
      { key: 'opusModel', labelKey: 'ccswitch.fModelOpus', required: false },
    ],
  },
  {
    key: 'codex',
    label: 'Codex',
    defaultName: 'My Codex',
    fields: [{ key: 'model', labelKey: 'ccswitch.fModelMain', required: true }],
  },
  {
    key: 'gemini',
    label: 'Gemini',
    defaultName: 'My Gemini',
    fields: [{ key: 'model', labelKey: 'ccswitch.fModelMain', required: true }],
  },
] as const

type AppKey = (typeof APPS)[number]['key']

const app = ref<AppKey>('claude')
const name = ref('')
const models = ref<Record<string, string>>({})
const formError = ref<string | null>(null)

const currentApp = computed(() => APPS.find((a) => a.key === app.value)!)

/**
 * 配置名默认值：优先用密钥名（用户自己起的，在 CC Switch 里更好认），
 * 没有才回落到应用的通用名。
 */
const defaultName = computed(() => props.tokenName?.trim() || currentApp.value.defaultName)

/** 每次打开都重置 —— 上次选的模型对这次的密钥未必适用 */
watch(
  () => props.open,
  (open) => {
    if (!open) return
    app.value = 'claude'
    name.value = defaultName.value
    models.value = {}
    formError.value = null
    openField.value = null
    search.value = ''
  },
)

function selectApp(key: AppKey) {
  if (key === app.value) return
  app.value = key
  // 各应用的模型不通用（Codex 选的模型放到 Claude 下没意义），一并清掉
  name.value = defaultName.value
  models.value = {}
  formError.value = null
  openField.value = null
}

// ───────────────── 模型下拉（可搜索，同页面其它下拉的交互） ─────────────────

/** 当前展开的字段 key，null 表示都收起 —— 同时只允许开一个 */
const openField = ref<string | null>(null)
const search = ref('')
const dropdownWrap = ref<HTMLElement | null>(null)

const filteredModels = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.models
  return props.models.filter((m) => m.toLowerCase().includes(q))
})

function toggleField(key: string) {
  openField.value = openField.value === key ? null : key
  search.value = ''
}

function pickModel(field: string, model: string) {
  // 再点一次已选中的项即取消选择（非必填字段留空是合法的）
  models.value = { ...models.value, [field]: models.value[field] === model ? '' : model }
  openField.value = null
  search.value = ''
}

function onDocClick(e: MouseEvent) {
  if (!dropdownWrap.value?.contains(e.target as Node)) openField.value = null
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

// ───────────────── 构造并唤起 ccswitch:// ─────────────────

/**
 * 拼 CC Switch 导入链接。URLSearchParams 负责转义，
 * 站点地址/模型名里的特殊字符不会破坏 URL。
 */
function buildUrl() {
  const base = serverAddress.value
  const params = new URLSearchParams({
    resource: 'provider',
    app: app.value,
    name: name.value.trim() || defaultName.value,
    // Codex 走 OpenAI 兼容端点，需要显式的 /v1
    endpoint: app.value === 'codex' ? `${base}/v1` : base,
    apiKey: `sk-${props.tokenKey}`,
  })
  for (const [k, v] of Object.entries(models.value)) {
    if (v) params.set(k, v)
  }
  params.set('homepage', base)
  params.set('enabled', 'true')
  return `ccswitch://v1/import?${params.toString()}`
}

function onSubmit() {
  formError.value = null
  if (!models.value.model) {
    formError.value = t('ccswitch.errModel')
    return
  }
  // 自定义协议交给系统处理；未安装 CC Switch 时浏览器静默忽略，
  // 无从探测，所以文案只说「已唤起」。
  window.location.href = buildUrl()
  emit('opened')
  emit('close')
}
</script>

<template>
  <AppModal
    :open="open"
    :title="t('ccswitch.title')"
    :description="t('ccswitch.desc')"
    :width="480"
    @close="emit('close')"
  >
    <div ref="dropdownWrap" class="space-y-4">
      <!-- 目标应用 -->
      <div>
        <p class="mb-1.5 text-[12.5px] font-medium">{{ t('ccswitch.fApp') }}</p>
        <div class="flex gap-1.5">
          <button
            v-for="a in APPS"
            :key="a.key"
            type="button"
            class="motion-press h-9 flex-1 rounded-lg border text-[12.5px] font-medium transition-colors"
            :class="
              app === a.key
                ? 'border-border-selected bg-bg-muted text-fg'
                : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg'
            "
            :aria-pressed="app === a.key"
            @click="selectApp(a.key)"
          >
            {{ a.label }}
          </button>
        </div>
      </div>

      <!-- 配置名称（写进 CC Switch 的供应商列表） -->
      <FormField id="cc-name" :label="t('ccswitch.fName')" :hint="t('ccswitch.fNameHint')">
        <input
          id="cc-name"
          v-model="name"
          type="text"
          maxlength="64"
          :placeholder="defaultName"
          class="h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
        />
      </FormField>

      <!-- 模型：主模型必填，其余为 Claude 的快慢档可选覆盖 -->
      <div
        v-for="f in currentApp.fields"
        :key="f.key"
        class="relative"
      >
        <p class="mb-1.5 text-[12.5px] font-medium">
          {{ t(f.labelKey) }}
          <span v-if="f.required" class="text-danger-fg" aria-hidden="true">*</span>
        </p>
        <button
          type="button"
          :aria-expanded="openField === f.key"
          :aria-label="t(f.labelKey)"
          class="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected"
          @click="toggleField(f.key)"
        >
          <span v-if="models[f.key]" class="truncate font-mono text-[12.5px]">
            {{ models[f.key] }}
          </span>
          <span v-else class="truncate text-fg-muted">{{ t('ccswitch.pickModel') }}</span>
          <ChevronDown
            class="ml-auto size-3.5 shrink-0 text-fg-subtle transition-transform"
            :class="openField === f.key ? 'rotate-180' : ''"
          />
        </button>

        <div
          v-if="openField === f.key"
          class="absolute left-0 right-0 top-full z-20 mt-1.5 rounded-lg border border-border bg-bg-elevated shadow-lg"
        >
          <!-- 模型可能上百个，先给个搜索框 -->
          <div class="border-b border-border p-1.5">
            <div class="relative">
              <Search
                class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
              />
              <input
                v-model="search"
                type="text"
                :placeholder="t('ccswitch.searchModel')"
                class="h-8 w-full rounded-md border border-border bg-bg pl-8 pr-2.5 text-[12.5px] outline-none transition-colors focus:border-border-selected"
                @click.stop
              />
            </div>
          </div>
          <div class="max-h-56 overflow-y-auto py-1">
            <button
              v-for="m in filteredModels"
              :key="m"
              type="button"
              class="motion-press flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-muted"
              :class="models[f.key] === m ? 'bg-bg-muted' : ''"
              @click="pickModel(f.key, m)"
            >
              <Check v-if="models[f.key] === m" class="size-3.5 shrink-0 text-accent" />
              <span v-else class="size-3.5 shrink-0" />
              <span class="min-w-0 flex-1 truncate font-mono text-[12px]">{{ m }}</span>
            </button>
            <p
              v-if="!filteredModels.length"
              class="px-3 py-4 text-center text-[12px] text-fg-subtle"
            >
              {{ t('ccswitch.noModel') }}
            </p>
          </div>
        </div>
      </div>

      <p class="text-[11.5px] text-fg-subtle">{{ t('ccswitch.hint') }}</p>
      <p v-if="formError" class="text-[12.5px] text-danger-fg">{{ formError }}</p>
    </div>

    <template #footer>
      <AppButton @click="emit('close')">{{ t('common.cancel') }}</AppButton>
      <AppButton variant="primary" @click="onSubmit">{{ t('ccswitch.submit') }}</AppButton>
    </template>
  </AppModal>
</template>
