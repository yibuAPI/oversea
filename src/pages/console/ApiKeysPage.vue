<script setup lang="ts">
/**
 * API 密钥。对齐 infron API Keys 页的表格结构（名称/状态/创建时间/最后使用/操作），
 * 但字段以后端真实能力为准：
 *   - key 列表里是打码的，页面始终只显示打码版；复制时调 /token/:id/key 取真值，不展开明文
 *   - 创建接口不返回 data，故建完必须重新拉列表
 *   - 分组是必填项（后端按 groups 路由），下拉数据来自 /user/self/groups
 */
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import {
  Plus,
  Copy,
  Trash2,
  Pencil,
  KeyRound,
  Check,
  Ban,
  CircleCheck,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import {
  listTokens,
  createToken,
  updateToken,
  deleteToken,
  setTokenStatus,
  revealTokenKey,
  parseTokenGroups,
} from '@/api/tokens'
import { getMyGroups, getMyModels, getPricing } from '@/api/models'
import { TOKEN_STATUS, type ApiToken } from '@/api/types'
import { formatDateTime, formatQuota, formatRelative } from '@/lib/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import FormField from '@/components/ui/FormField.vue'
import Pagination from '@/components/ui/Pagination.vue'

const site = useSiteStore()
const { quotaPerUnit } = storeToRefs(site)
const { t } = useI18n()
const qc = useQueryClient()

const page = ref(1)
const pageSize = ref(20)
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const tokensQ = useQuery({
  queryKey: computed(() => ['tokens', page.value, pageSize.value]),
  queryFn: () => listTokens({ p: page.value, page_size: pageSize.value }),
})

/** 改每页条数后总页数变了，回到第 1 页避免停在越界页 */
function onPageSizeChange(n: number) {
  pageSize.value = n
  page.value = 1
}

const groupsQ = useQuery({ queryKey: ['my-groups'], queryFn: getMyGroups })
const modelsQ = useQuery({ queryKey: ['my-models'], queryFn: () => getMyModels() })
/** 模型库同源：每个分组开放多少可用模型（/api/pricing 的 enable_groups） */
const pricingQ = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

const rows = computed(() => tokensQ.data.value?.items ?? [])

const columns: Column[] = [
  { key: 'name', label: t('keys.colName'), class: 'w-[200px]' },
  { key: 'group', label: t('keys.colGroup'), class: 'w-[260px]' },
  { key: 'key', label: t('keys.colKey'), class: 'w-[210px]' },
  { key: 'status', label: t('keys.colStatus'), class: 'w-[100px]' },
  { key: 'quota', label: t('keys.colUsage'), class: 'w-[150px]', numeric: true },
  { key: 'created_time', label: t('keys.colCreated'), class: 'w-[170px]' },
  { key: 'accessed_time', label: t('keys.colLastUsed'), class: 'w-[140px]' },
  { key: 'actions', label: '', class: 'w-[120px]' },
]

// ───────────────── 复制密钥（显示打码，复制真值） ─────────────────

/** 正在复制中的 id，用于禁用复制按钮 */
const copying = ref<number | null>(null)

async function onCopy(id: number) {
  const row = rows.value.find((r) => r.id === id)
  if (!row) return
  copying.value = id
  try {
    // 列表里只有打码的 key，真要复制得调接口取明文；取到一并拼 sk- 前缀
    const { key } = await revealTokenKey(id)
    const full = `sk-${key}`
    await navigator.clipboard.writeText(full)
    toast(t('keys.copied'))
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true)
  } finally {
    copying.value = null
  }
}

// ───────────────── 轻量 toast ─────────────────

const notice = ref<{ msg: string; error: boolean } | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined
function toast(msg: string, error = false) {
  notice.value = { msg, error }
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = null), 3000)
}

// ───────────────── 新建 / 编辑 ─────────────────

interface FormState {
  id: number | null
  name: string
  groups: string[]
  cross_group_retry: boolean
  unlimited_quota: boolean
  /** 表单里用美元，提交前换算成 quota */
  quotaUsd: string
  /** 'never' | 'preset' 天数 | 'custom' */
  expiry: string
  customExpiry: string
  model_limits_enabled: boolean
  model_limits: string[]
  allow_ips: string
}

function blankForm(): FormState {
  return {
    id: null,
    name: '',
    groups: [],
    cross_group_retry: false,
    unlimited_quota: true,
    quotaUsd: '',
    expiry: 'never',
    customExpiry: '',
    model_limits_enabled: false,
    model_limits: [],
    allow_ips: '',
  }
}

const modalOpen = ref(false)
const form = ref<FormState>(blankForm())
const formError = ref<string | null>(null)

/** 默认分组：优先 default，否则第一个 */
const groupOptions = computed(() => Object.keys(groupsQ.data.value ?? {}))
watch(groupOptions, (opts) => {
  if (!form.value.groups.length && opts.length) {
    form.value.groups = [opts.includes('default') ? 'default' : opts[0]!]
  }
})

/** 每个分组开放了多少可用模型（同模型库的「N 可用模型」标签） */
const groupCounts = computed(() => {
  const m = new Map<string, number>()
  for (const x of pricingQ.data.value?.data ?? []) {
    for (const g of x.enable_groups ?? []) m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
})

/** 分组倍率：auto 分组在 /user/self/groups 里可能是字符串，按 1 处理并原样展示 */
const ratioOf = (g: string) => {
  const v = groupsQ.data.value?.[g]?.ratio
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1
}

/** 倍率标签：1 → "1"，0.25 → "0.25"（去掉浮点尾噪，同模型库） */
const ratioLabel = (n: number) => String(Number.parseFloat(n.toFixed(2)))

/** 分组下拉的展开/收起，以及点击外部关闭（对齐模型库） */
const groupOpen = ref(false)
const groupWrap = ref<HTMLElement | null>(null)
/** 过期时间下拉（同分组下拉，做成自定义样式） */
const expiryOpen = ref(false)
const expiryWrap = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (!groupWrap.value || !groupWrap.value.contains(t)) groupOpen.value = false
  if (!expiryWrap.value || !expiryWrap.value.contains(t)) expiryOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})

/** 切换分组选择（多选）；下拉保留展开以便继续勾选 */
function toggleGroupForm(g: string) {
  const i = form.value.groups.indexOf(g)
  if (i >= 0) form.value.groups.splice(i, 1)
  else form.value.groups.push(g)
}

function selectExpiry(v: string) {
  form.value.expiry = v
  expiryOpen.value = false
}

function openCreate() {
  form.value = blankForm()
  const opts = groupOptions.value
  if (opts.length) form.value.groups = [opts.includes('default') ? 'default' : opts[0]!]
  formError.value = null
  modalOpen.value = true
}

function openEdit(row: ApiToken) {
  form.value = {
    id: row.id,
    name: row.name,
    groups: parseTokenGroups(row),
    cross_group_retry: row.cross_group_retry,
    unlimited_quota: row.unlimited_quota,
    quotaUsd: row.unlimited_quota
      ? ''
      : String(row.remain_quota / (quotaPerUnit.value || 1)),
    expiry: row.expired_time === -1 ? 'never' : 'custom',
    customExpiry:
      row.expired_time === -1 ? '' : toLocalInput(row.expired_time),
    model_limits_enabled: row.model_limits_enabled,
    model_limits: row.model_limits ? row.model_limits.split(',').filter(Boolean) : [],
    allow_ips: row.allow_ips ?? '',
  }
  formError.value = null
  modalOpen.value = true
}

/** unix 秒 -> datetime-local 需要的 YYYY-MM-DDTHH:mm（本地时区） */
function toLocalInput(unix: number) {
  const d = new Date(unix * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const EXPIRY_PRESETS = [
  { value: 'never', days: -1 },
  { value: '1', days: 1 },
  { value: '7', days: 7 },
  { value: '30', days: 30 },
  { value: '90', days: 90 },
  { value: 'custom', days: 0 },
] as const

function resolveExpiry(): number | null {
  const f = form.value
  if (f.expiry === 'never') return -1
  if (f.expiry === 'custom') {
    if (!f.customExpiry) return null
    const ts = Math.floor(new Date(f.customExpiry).getTime() / 1000)
    return Number.isFinite(ts) ? ts : null
  }
  return Math.floor(Date.now() / 1000) + Number(f.expiry) * 86400
}

/** 分组列默认最多展示 3 个，超出折叠到「+N」按钮里 */
const GROUP_VISIBLE = 3

/** 点开「+N」展开完整分组的行 id 集合（按行独立，翻页后自然重置） */
const groupExpanded = ref<Set<number>>(new Set())

function toggleGroupExpand(id: number) {
  const next = new Set(groupExpanded.value)
  if (!next.delete(id)) next.add(id)
  groupExpanded.value = next
}

/** 分组徽章：分组名 + 各自倍率（×n）。未展开时截断到 GROUP_VISIBLE 个 */
function groupBadges(row: ApiToken): { name: string; ratio: number }[] {
  const all = parseTokenGroups(row)
  const list = groupExpanded.value.has(row.id) ? all : all.slice(0, GROUP_VISIBLE)
  return list.map((g) => ({ name: g, ratio: ratioOf(g) }))
}

// ───────────────── 分组列彩色标签（对齐模型库色调） ─────────────────

const TOKEN_TONES = [
  'text-sky-600 dark:text-sky-400',
  'text-violet-600 dark:text-violet-400',
  'text-amber-600 dark:text-amber-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-rose-600 dark:text-rose-400',
  'text-cyan-600 dark:text-cyan-400',
]

/** 给分组名映射一个稳定的文字色（同 ModelTable 的 toneOf） */
function toneOf(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  return TOKEN_TONES[Math.abs(h) % TOKEN_TONES.length]
}

const saveMut = useMutation({
  mutationFn: async () => {
    const f = form.value
    const expired_time = resolveExpiry()
    if (expired_time == null) throw new Error(t('keys.errExpiry'))

    const remain_quota = f.unlimited_quota
      ? 0
      : Math.round(Number(f.quotaUsd || 0) * quotaPerUnit.value)

    const payload = {
      name: f.name.trim(),
      expired_time,
      remain_quota,
      unlimited_quota: f.unlimited_quota,
      model_limits_enabled: f.model_limits_enabled,
      model_limits: f.model_limits.join(','),
      // 空串和 null 后端都当「不限制」，统一传 null 更明确
      allow_ips: f.allow_ips.trim() || null,
      cross_group_retry: f.cross_group_retry,
      groups: f.groups,
    }

    if (f.id != null) return updateToken({ ...payload, id: f.id })
    return createToken(payload)
  },
  onSuccess: () => {
    modalOpen.value = false
    toast(form.value.id != null ? t('keys.updated') : t('keys.created'))
    // 创建接口不回 data，只能重新拉
    qc.invalidateQueries({ queryKey: ['tokens'] })
  },
  onError: (e) => {
    formError.value = e instanceof Error ? e.message : String(e)
  },
})

function onSubmit() {
  formError.value = null
  if (!form.value.name.trim()) {
    formError.value = t('keys.errName')
    return
  }
  if (!form.value.groups.length) {
    formError.value = t('keys.errGroup')
    return
  }
  if (!form.value.unlimited_quota) {
    const n = Number(form.value.quotaUsd)
    if (!Number.isFinite(n) || n <= 0) {
      formError.value = t('keys.errQuota')
      return
    }
  }
  saveMut.mutate()
}

// ───────────────── 状态切换 / 删除 ─────────────────

const statusMut = useMutation({
  mutationFn: ({ id, status }: { id: number; status: number }) =>
    setTokenStatus(id, status),
  onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  onError: (e) => toast(e instanceof Error ? e.message : String(e), true),
})

const delTarget = ref<ApiToken | null>(null)
const delMut = useMutation({
  mutationFn: (id: number) => deleteToken(id),
  onSuccess: () => {
    delTarget.value = null
    toast(t('keys.deleted'))
    qc.invalidateQueries({ queryKey: ['tokens'] })
  },
  onError: (e) => toast(e instanceof Error ? e.message : String(e), true),
})

const STATUS_META: Record<number, { key: string; cls: string }> = {
  [TOKEN_STATUS.ENABLED]: {
    key: 'keys.status_1',
    cls: 'border-success-border bg-success-bg text-success-fg',
  },
  [TOKEN_STATUS.DISABLED]: {
    key: 'keys.status_2',
    cls: 'border-border bg-bg-muted text-fg-muted',
  },
  [TOKEN_STATUS.EXPIRED]: {
    key: 'keys.status_3',
    cls: 'border-warning-border bg-warning-bg text-warning-fg',
  },
  [TOKEN_STATUS.EXHAUSTED]: {
    key: 'keys.status_4',
    cls: 'border-danger-border bg-danger-bg text-danger-fg',
  },
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PageHeader :title="t('keys.title')" :description="t('keys.subtitle')">
      <template #actions>
        <AppButton variant="primary" @click="openCreate">
          <Plus class="size-3.5" />
          {{ t('keys.add') }}
        </AppButton>
      </template>
    </PageHeader>

    <DataTable
      class="flex-1"
      :columns="columns"
      :rows="rows"
      :row-key="(r) => r.id"
      :loading="tokensQ.isLoading.value"
      :error="tokensQ.error.value ? String(tokensQ.error.value.message) : null"
      @retry="tokensQ.refetch()"
    >
      <template #empty>
        <KeyRound class="mx-auto size-7 text-fg-subtle" />
        <p class="mt-3 text-[13.5px] font-medium">{{ t('keys.emptyTitle') }}</p>
        <p class="mx-auto mt-1 max-w-[320px] text-[12.5px] text-fg-subtle">
          {{ t('keys.emptyDesc') }}
        </p>
        <AppButton variant="primary" size="sm" class="mt-4" @click="openCreate">
          <Plus class="size-3.5" />
          {{ t('keys.add') }}
        </AppButton>
      </template>

      <template #cell="{ row, column }">
        <!-- 名称 -->
        <template v-if="column.key === 'name'">
          <p class="truncate font-medium">{{ row.name }}</p>
          <p v-if="row.model_limits_enabled" class="mt-0.5 text-[11px] text-fg-subtle">
            {{ t('keys.modelLimited') }}
          </p>
        </template>

        <!-- 分组 + 倍率：彩色标签纯展示（编辑走右侧「编辑」按钮） -->
        <template v-else-if="column.key === 'group'">
          <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <template v-if="groupBadges(row).length">
              <template v-for="(g, i) in groupBadges(row)" :key="g.name">
                <span
                  :title="`${g.name} ×${ratioLabel(g.ratio)}`"
                  class="inline-flex max-w-[120px] items-center gap-1 whitespace-nowrap"
                >
                  <span
                    class="truncate rounded bg-bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none"
                    :class="toneOf(g.name)"
                  >{{ g.name }}</span>
                  <span class="text-[10.5px] leading-none text-fg-subtle">
                    ×{{ ratioLabel(g.ratio) }}
                  </span>
                </span>
                <!-- 分组按顺序命中，用箭头表达先后 -->
                <ArrowRight
                  v-if="i < groupBadges(row).length - 1"
                  class="size-3 shrink-0 text-fg-subtle"
                />
              </template>
            </template>
            <span v-else class="text-[11px] leading-none text-fg-muted">{{ t('keys.fGroupPlaceholder') }}</span>
            <!-- 超过 3 个分组时折叠，箭头图标展开/收起 -->
            <button
              v-if="parseTokenGroups(row).length > GROUP_VISIBLE"
              type="button"
              class="motion-press flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
              :title="
                groupExpanded.has(row.id)
                  ? t('common.collapse')
                  : parseTokenGroups(row).join(' → ')
              "
              @click="toggleGroupExpand(row.id)"
            >
              <ChevronUp v-if="groupExpanded.has(row.id)" class="size-3.5" />
              <ChevronDown v-else class="size-3.5" />
            </button>
          </div>
          <p
            v-if="row.cross_group_retry"
            class="mt-1 inline-flex items-center rounded-full border border-info-border bg-info-bg px-1.5 py-0.5 text-[10.5px] leading-none text-info-fg"
          >{{ t('keys.crossGroupRetry') }}</p>
        </template>

        <!-- 密钥（列表只显示打码版，复制走接口拿真值） -->
        <template v-else-if="column.key === 'key'">
          <div class="flex items-center gap-1">
            <code class="min-w-0 truncate font-mono text-[11.5px]">
              {{ `sk-${row.key}` }}
            </code>
            <button
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg disabled:opacity-50"
              :title="t('common.copy')"
              :aria-label="t('common.copy')"
              :disabled="copying === row.id"
              @click="onCopy(row.id)"
            >
              <Copy class="size-3.5" />
            </button>
          </div>
        </template>

        <!-- 状态 -->
        <template v-else-if="column.key === 'status'">
          <span
            class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
            :class="STATUS_META[row.status]?.cls ?? 'border-border bg-bg-muted text-fg-muted'"
          >
            {{ t(STATUS_META[row.status]?.key ?? 'keys.statusUnknown') }}
          </span>
        </template>

        <!-- 用量 / 额度 -->
        <template v-else-if="column.key === 'quota'">
          <p>{{ formatQuota(row.used_quota, quotaPerUnit) }}</p>
          <p class="mt-0.5 text-[11px] text-fg-subtle">
            {{
              row.unlimited_quota
                ? t('keys.unlimited')
                : t('keys.remain', { v: formatQuota(row.remain_quota, quotaPerUnit) })
            }}
          </p>
        </template>

        <!-- 创建时间 + 过期 -->
        <template v-else-if="column.key === 'created_time'">
          <p>{{ formatDateTime(row.created_time) }}</p>
          <p class="mt-0.5 text-[11px] text-fg-subtle">
            {{
              t('keys.expires', {
                v: row.expired_time === -1 ? t('keys.never') : formatDateTime(row.expired_time),
              })
            }}
          </p>
        </template>

        <!-- 最后使用：与创建时间相同说明从未用过 -->
        <template v-else-if="column.key === 'accessed_time'">
          <span :class="row.accessed_time <= row.created_time ? 'text-fg-subtle' : ''">
            {{
              row.accessed_time <= row.created_time
                ? t('keys.neverUsed')
                : formatRelative(row.accessed_time)
            }}
          </span>
        </template>

        <!-- 操作 -->
        <template v-else-if="column.key === 'actions'">
          <div class="flex items-center justify-end gap-0.5">
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :title="row.status === TOKEN_STATUS.ENABLED ? t('keys.disable') : t('keys.enable')"
              :aria-label="row.status === TOKEN_STATUS.ENABLED ? t('keys.disable') : t('keys.enable')"
              @click="
                statusMut.mutate({
                  id: row.id,
                  status:
                    row.status === TOKEN_STATUS.ENABLED
                      ? TOKEN_STATUS.DISABLED
                      : TOKEN_STATUS.ENABLED,
                })
              "
            >
              <Ban v-if="row.status === TOKEN_STATUS.ENABLED" class="size-3.5" />
              <CircleCheck v-else class="size-3.5" />
            </button>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :title="t('common.edit')"
              :aria-label="t('common.edit')"
              @click="openEdit(row)"
            >
              <Pencil class="size-3.5" />
            </button>
            <button
              type="button"
              class="flex size-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-danger-bg hover:text-danger-fg"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              @click="delTarget = row"
            >
              <Trash2 class="size-3.5" />
            </button>
          </div>
        </template>
      </template>
    </DataTable>

    <Pagination
      v-model:page="page"
      :page-size="pageSize"
      :total="tokensQ.data.value?.total ?? 0"
      :page-size-options="PAGE_SIZE_OPTIONS"
      @update:page-size="onPageSizeChange"
    />

    <!-- 新建 / 编辑 -->
    <AppModal
      :open="modalOpen"
      :title="form.id != null ? t('keys.editTitle') : t('keys.createTitle')"
      :description="t('keys.createDesc')"
      :width="520"
      @close="modalOpen = false"
    >
      <form class="space-y-4" @submit.prevent="onSubmit">
        <FormField id="k-name" :label="t('keys.fName')" required>
          <input
            id="k-name"
            v-model="form.name"
            type="text"
            maxlength="256"
            :placeholder="t('keys.fNamePlaceholder')"
            class="h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          />
        </FormField>

        <FormField id="k-group" :label="t('keys.fGroup')" :hint="t('keys.fGroupHint')" required>
          <div ref="groupWrap" class="relative">
            <button
              type="button"
              :aria-expanded="groupOpen"
              :aria-label="t('keys.fGroup')"
              class="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected"
              @click="groupOpen = !groupOpen"
            >
              <span v-if="form.groups.length" class="truncate">{{ form.groups.join(', ') }}</span>
              <span v-else class="truncate text-fg-muted">{{ t('keys.fGroupPlaceholder') }}</span>
              <ChevronDown
                class="ml-auto size-3.5 shrink-0 text-fg-subtle transition-transform"
                :class="groupOpen ? 'rotate-180' : ''"
              />
            </button>

            <div
              v-if="groupOpen"
              class="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
            >
              <button
                v-for="g in groupOptions"
                :key="g"
                type="button"
                class="motion-press flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-bg-muted"
                :class="form.groups.includes(g) ? 'bg-bg-muted' : ''"
                @click="toggleGroupForm(g)"
              >
                <Check
                  v-if="form.groups.includes(g)"
                  class="mt-0.5 size-3.5 shrink-0 text-accent"
                />
                <span v-else class="mt-0.5 size-3.5 shrink-0" />
                <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-[12.5px] font-semibold text-fg">{{ g }}</span>
                  <span
                    v-if="groupsQ.data.value?.[g]?.desc && groupsQ.data.value[g]!.desc !== g"
                    class="text-[11.5px] text-fg-muted"
                  >
                    {{ groupsQ.data.value[g]!.desc }}
                  </span>
                </span>
                <span class="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <span
                    class="rounded bg-success-bg px-2 py-1 text-[10.5px] leading-none text-success-fg"
                  >
                    {{ t('models.groupAvailable', { n: groupCounts.get(g) ?? 0 }) }}
                  </span>
                  <span
                    class="rounded bg-info-bg px-2 py-1 text-[10.5px] leading-none text-info-fg"
                  >
                    {{ t('models.groupRatio', { n: ratioLabel(ratioOf(g)) }) }}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </FormField>

        <div>
          <label class="flex items-center gap-2 text-[12.5px]">
            <input
              v-model="form.cross_group_retry"
              type="checkbox"
              class="size-3.5 rounded border-border accent-[var(--color-accent)]"
            />
            {{ t('keys.crossGroupRetry') }}
          </label>
          <p class="mt-1 text-[11.5px] text-fg-subtle">{{ t('keys.crossGroupHint') }}</p>
        </div>

        <FormField id="k-expiry" :label="t('keys.fExpiry')">
          <div ref="expiryWrap" class="relative">
            <button
              type="button"
              :aria-expanded="expiryOpen"
              :aria-label="t('keys.fExpiry')"
              class="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected"
              @click="expiryOpen = !expiryOpen"
            >
              <span class="truncate">{{ t(`keys.expiry_${form.expiry}`) }}</span>
              <ChevronDown
                class="ml-auto size-3.5 shrink-0 text-fg-subtle transition-transform"
                :class="expiryOpen ? 'rotate-180' : ''"
              />
            </button>

            <div
              v-if="expiryOpen"
              class="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
            >
              <button
                v-for="p in EXPIRY_PRESETS"
                :key="p.value"
                type="button"
                class="motion-press flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-muted"
                :class="form.expiry === p.value ? 'bg-bg-muted' : ''"
                @click="selectExpiry(p.value)"
              >
                <Check
                  v-if="form.expiry === p.value"
                  class="size-3.5 shrink-0 text-accent"
                />
                <span v-else class="size-3.5 shrink-0" />
                <span class="flex-1 text-[12.5px] font-semibold text-fg">
                  {{ t(`keys.expiry_${p.value}`) }}
                </span>
              </button>
            </div>
          </div>
          <input
            v-if="form.expiry === 'custom'"
            v-model="form.customExpiry"
            type="datetime-local"
            class="mt-2 h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected"
          />
        </FormField>

        <div>
          <label class="flex items-center gap-2 text-[12.5px]">
            <input
              v-model="form.unlimited_quota"
              type="checkbox"
              class="size-3.5 rounded border-border accent-[var(--color-accent)]"
            />
            {{ t('keys.fUnlimited') }}
          </label>
          <div v-if="!form.unlimited_quota" class="mt-2">
            <div class="relative">
              <span
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-subtle"
              >
                $
              </span>
              <input
                v-model="form.quotaUsd"
                type="number"
                step="0.01"
                min="0"
                class="h-9 w-full rounded-lg border border-border bg-bg pl-6 pr-3 text-[13px] tabular outline-none transition-colors focus:border-border-selected"
              />
            </div>
            <p class="mt-1 text-[11.5px] text-fg-subtle">{{ t('keys.fQuotaHint') }}</p>
          </div>
        </div>

        <div>
          <label class="flex items-center gap-2 text-[12.5px]">
            <input
              v-model="form.model_limits_enabled"
              type="checkbox"
              class="size-3.5 rounded border-border accent-[var(--color-accent)]"
            />
            {{ t('keys.fModelLimit') }}
          </label>
          <select
            v-if="form.model_limits_enabled"
            v-model="form.model_limits"
            multiple
            size="6"
            class="mt-2 w-full rounded-lg border border-border bg-bg p-1.5 text-[12.5px] outline-none transition-colors focus:border-border-selected"
          >
            <option v-for="m in modelsQ.data.value ?? []" :key="m" :value="m">
              {{ m }}
            </option>
          </select>
          <p v-if="form.model_limits_enabled" class="mt-1 text-[11.5px] text-fg-subtle">
            {{ t('keys.fModelLimitHint') }}
          </p>
        </div>

        <FormField id="k-ips" :label="t('keys.fAllowIps')" :hint="t('keys.fAllowIpsHint')">
          <input
            id="k-ips"
            v-model="form.allow_ips"
            type="text"
            placeholder="203.0.113.1, 198.51.100.0/24"
            class="h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-[12.5px] outline-none transition-colors focus:border-border-selected"
          />
        </FormField>

        <p v-if="formError" class="text-[12.5px] text-danger-fg">{{ formError }}</p>
      </form>

      <template #footer>
        <AppButton @click="modalOpen = false">{{ t('common.cancel') }}</AppButton>
        <AppButton variant="primary" :loading="saveMut.isPending.value" @click="onSubmit">
          {{ form.id != null ? t('common.save') : t('common.create') }}
        </AppButton>
      </template>
    </AppModal>

    <!-- 删除确认 -->
    <AppModal
      :open="delTarget != null"
      :title="t('keys.delTitle')"
      :description="t('keys.delDesc', { name: delTarget?.name ?? '' })"
      @close="delTarget = null"
    >
      <p class="text-[13px] text-fg-muted">{{ t('keys.delWarn') }}</p>
      <template #footer>
        <AppButton @click="delTarget = null">{{ t('common.cancel') }}</AppButton>
        <AppButton
          variant="danger"
          :loading="delMut.isPending.value"
          @click="delTarget && delMut.mutate(delTarget.id)"
        >
          {{ t('common.delete') }}
        </AppButton>
      </template>
    </AppModal>

    <!-- toast -->
    <Transition
      enter-active-class="transition-all duration-200"
      leave-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="notice"
        role="status"
        aria-live="polite"
        class="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-lg border px-3.5 py-2 text-[12.5px] shadow-lg"
        :class="
          notice.error
            ? 'border-danger-border bg-danger-bg text-danger-fg'
            : 'border-success-border bg-success-bg text-success-fg'
        "
      >
        <span class="flex items-center gap-1.5">
          <Check v-if="!notice.error" class="size-3.5" />
          {{ notice.msg }}
        </span>
      </div>
    </Transition>
  </div>
</template>
