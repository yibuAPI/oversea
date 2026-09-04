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
  KeyRound,
  Check,
  ChevronDown,
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
import CcSwitchModal from '@/components/console/CcSwitchModal.vue'
import GroupSelector from '@/components/console/GroupSelector.vue'
import TokenGroupsPopover from '@/components/console/TokenGroupsPopover.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'

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
  { key: 'status', label: t('keys.colStatus'), class: 'min-w-[100px]' },
  { key: 'key', label: t('keys.colKey'), class: 'w-[260px]' },
  { key: 'quota', label: t('keys.colUsage'), class: 'w-[150px]', numeric: true },
  // 分组内容不折行。这里必须给定宽而不是 min-w：表格是 w-full，
  // 唯一没定宽的列会独吞所有剩余空间，右侧就空出一大片。
  // 定宽后剩余空间按比例摊给各列；分组过多时内容仍会把它撑开并触发横向滚动。
  { key: 'group', label: t('keys.colGroup'), class: 'w-[280px]' },
  { key: 'model_limits', label: t('keys.colModelLimits'), class: 'w-[130px]' },
  { key: 'allow_ips', label: t('keys.colAllowIps'), class: 'w-[130px]' },
  { key: 'created_time', label: t('keys.colCreated'), class: 'w-[195px]' },
  { key: 'expired_time', label: t('keys.colExpired'), class: 'w-[170px]' },
  { key: 'accessed_time', label: t('keys.colLastUsed'), class: 'min-w-[100px]' },
  { key: 'actions', label: '', class: 'w-[270px]', stickyRight: true },
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

// ───────────────── 填入 CC Switch ─────────────────

/**
 * CC Switch 需要明文密钥，和复制一样得走 revealTokenKey 现取 ——
 * 列表里的 key 是打码的。取 key 的接口有 CriticalRateLimit，
 * 所以只在用户点开时取一次，不预取。
 */
const ccOpen = ref(false)
const ccKey = ref('')
const ccName = ref('')
/** 正在取 key 的行 id，用于禁用按钮避免重复点 */
const ccLoading = ref<number | null>(null)

async function openCcSwitch(row: ApiToken) {
  ccLoading.value = row.id
  try {
    const { key } = await revealTokenKey(row.id)
    ccKey.value = key
    ccName.value = row.name
    ccOpen.value = true
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true)
  } finally {
    ccLoading.value = null
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

/** 每个分组开放了哪些模型；数量标签和悬停清单都从这里取，保证两者一致 */
const groupModels = computed(() => {
  const m = new Map<string, string[]>()
  for (const x of pricingQ.data.value?.data ?? []) {
    for (const g of x.enable_groups ?? []) {
      const list = m.get(g)
      if (list) list.push(x.model_name)
      else m.set(g, [x.model_name])
    }
  }
  return m
})

/** 每个分组开放了多少可用模型（同模型库的「N 可用模型」标签） */
const groupCounts = computed(
  () => new Map([...groupModels.value].map(([g, list]) => [g, list.length])),
)

/** 分组倍率：auto 分组在 /user/self/groups 里可能是字符串，按 1 处理并原样展示 */
const ratioOf = (g: string) => {
  const v = groupsQ.data.value?.[g]?.ratio
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1
}

/** 倍率标签：1 → "1"，0.25 → "0.25"（去掉浮点尾噪，同模型库） */
const ratioLabel = (n: number) => String(Number.parseFloat(n.toFixed(2)))

/** 过期时间下拉（自定义样式），以及点击外部关闭 */
const expiryOpen = ref(false)
const expiryWrap = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (!expiryWrap.value || !expiryWrap.value.contains(t)) expiryOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})

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

/**
 * 分组列最多展示 3 个，保证行高与列宽稳定。看全和编辑都走箭头打开的弹层
 * —— 箭头不再是「展开」，而是「编辑分组」的入口。
 */
const GROUP_VISIBLE = 3

/** 分组徽章：分组名 + 各自倍率（×n），截断到 GROUP_VISIBLE 个 */
function groupBadges(row: ApiToken): { name: string; ratio: number }[] {
  return parseTokenGroups(row)
    .slice(0, GROUP_VISIBLE)
    .map((g) => ({ name: g, ratio: ratioOf(g) }))
}

/** 被折起来的分组数，给单元格末尾的「+N」提示用 */
const groupOverflow = (row: ApiToken) =>
  Math.max(0, parseTokenGroups(row).length - GROUP_VISIBLE)

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

/**
 * 模型限制列表。model_limits 是逗号分隔串，且只在 model_limits_enabled
 * 为真时生效 —— 关掉开关但残留旧值的行不能算「有限制」。
 */
function modelLimitList(row: ApiToken): string[] {
  if (!row.model_limits_enabled) return []
  return (row.model_limits ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

/** IP 白名单。接口对「不限」既可能返回 null 也可能返回空串 */
function allowIpList(row: ApiToken): string[] {
  return (row.allow_ips ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ───────────────── 分组列内联编辑弹层 ─────────────────

/** 当前打开弹层的行；null 表示关闭 */
const groupPopRow = ref<ApiToken | null>(null)
/** 触发按钮，弹层的定位基准 */
const groupPopAnchor = ref<HTMLElement | null>(null)
/** 草稿：取消即丢弃，不碰行数据 */
const groupPopDraft = ref<string[]>([])
const groupPopRetry = ref(false)

// e 只用来取 currentTarget 作定位锚点，鼠标点击和键盘 Enter/Space 都会走这里
function openGroupPop(row: ApiToken, e: Event) {
  // 同一行再点一次 = 收起
  if (groupPopRow.value?.id === row.id) {
    closeGroupPop()
    return
  }
  groupPopAnchor.value = e.currentTarget as HTMLElement
  groupPopRow.value = row
  // parseTokenGroups 每次返回新数组；去重防止历史数据里的重复项渲染成两行
  groupPopDraft.value = [...new Set(parseTokenGroups(row))]
  groupPopRetry.value = row.cross_group_retry
}

function closeGroupPop() {
  groupPopRow.value = null
  groupPopAnchor.value = null
}

const groupMut = useMutation({
  mutationFn: async (v: { row: ApiToken; groups: string[]; retry: boolean }) => {
    const { row, groups, retry } = v
    // PUT /token/ 是整体覆盖而非 PATCH，其余字段必须原样带回，漏一个就会被清空
    return updateToken({
      id: row.id,
      name: row.name,
      expired_time: row.expired_time,
      remain_quota: row.remain_quota,
      unlimited_quota: row.unlimited_quota,
      model_limits_enabled: row.model_limits_enabled,
      model_limits: row.model_limits,
      allow_ips: row.allow_ips?.trim() ? row.allow_ips : null,
      cross_group_retry: retry,
      groups,
    })
  },
  onSuccess: () => {
    closeGroupPop()
    toast(t('keys.updated'))
    qc.invalidateQueries({ queryKey: ['tokens'] })
  },
  // 失败不关弹层，用户排好的顺序不能白丢
  onError: (e) => toast(e instanceof Error ? e.message : String(e), true),
})

function submitGroupPop() {
  const row = groupPopRow.value
  if (!row) return
  if (!groupPopDraft.value.length) {
    toast(t('keys.errGroup'), true)
    return
  }
  groupMut.mutate({
    row,
    groups: [...groupPopDraft.value],
    retry: groupPopRetry.value,
  })
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
    // 禁用是「这把密钥现在调不通」，属于要被一眼看见的异常态，不能和中性灰混在一起
    cls: 'border-danger-border bg-danger-bg text-danger-fg',
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
        </template>

        <!-- 分组 + 倍率：单行不折行，超出 3 个折起来，箭头就地打开弹层改顺序/增删。
             「跨分组重试」是整个令牌的属性、不属于任何单个分组，另起一行避免混进分组链。 -->
        <template v-else-if="column.key === 'group'">
          <div class="flex flex-col items-start gap-y-1">
            <!-- 点击区只包住实体内容：w-fit 让它贴合分组链宽度，
                 否则单元格右侧的空白也会成为可点区域，误触率很高 -->
            <div
              role="button"
              tabindex="0"
              class="motion-press -mx-1 flex w-fit cursor-pointer flex-nowrap items-center gap-x-1.5 whitespace-nowrap rounded px-1 py-0.5 transition-colors hover:bg-bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              :aria-label="t('keys.editGroups')"
              :aria-expanded="groupPopRow?.id === row.id"
              :title="parseTokenGroups(row).join(' → ') || t('keys.editGroups')"
              @click="openGroupPop(row, $event)"
              @keydown.enter.prevent="openGroupPop(row, $event)"
              @keydown.space.prevent="openGroupPop(row, $event)"
            >
              <template v-if="groupBadges(row).length">
                <template v-for="(g, i) in groupBadges(row)" :key="g.name">
                  <span
                    :title="`${g.name} ×${ratioLabel(g.ratio)}`"
                    class="inline-flex items-center gap-1"
                  >
                    <span
                      class="rounded bg-bg-muted px-1.5 py-0.5 text-[13px] font-medium leading-none"
                      :class="toneOf(g.name)"
                    >{{ g.name }}</span>
                    <span class="text-[12px] leading-none text-fg-subtle">
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
              <span v-else class="text-[13px] leading-none text-fg-muted">{{ t('keys.fGroupPlaceholder') }}</span>
              <!-- 超出 3 个的部分不展开，统一到弹层里看全 -->
              <span v-if="groupOverflow(row)" class="text-[11px] leading-none text-fg-subtle">
                {{ t('keys.groupMore', { n: groupOverflow(row) }) }}
              </span>
              <ChevronDown
                class="size-3.5 shrink-0 text-fg-subtle transition-transform"
                :class="groupPopRow?.id === row.id ? 'rotate-180' : ''"
              />
            </div>
            <span
              v-if="row.cross_group_retry"
              class="inline-flex items-center rounded-full border border-info-border bg-info-bg px-1.5 py-0.5 text-[11px] leading-none text-info-fg"
            >{{ t('keys.crossGroupRetry') }}</span>
          </div>
        </template>

        <!-- 密钥（列表只显示打码版，复制走接口拿真值） -->
        <template v-else-if="column.key === 'key'">
          <div class="flex items-center gap-1">
            <code class="min-w-0 truncate font-mono text-[13px]">
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

        <!-- 模型限制：未开启就是分组下全部模型可用 -->
        <template v-else-if="column.key === 'model_limits'">
          <span
            v-if="modelLimitList(row).length"
            class="cursor-default text-[12px] text-fg-secondary"
            :title="modelLimitList(row).join(', ')"
          >{{ t('keys.modelLimited', { n: modelLimitList(row).length }) }}</span>
          <span v-else class="text-[12px] text-fg-subtle">{{ t('keys.noLimit') }}</span>
        </template>

        <!-- IP 限制：allow_ips 空串/ null 都表示不限 -->
        <template v-else-if="column.key === 'allow_ips'">
          <span
            v-if="allowIpList(row).length"
            class="cursor-default text-[12px] text-fg-secondary"
            :title="allowIpList(row).join(', ')"
          >{{ t('keys.ipCount', { n: allowIpList(row).length }) }}</span>
          <span v-else class="text-[12px] text-fg-subtle">{{ t('keys.noLimit') }}</span>
        </template>

        <!-- 创建时间 -->
        <template v-else-if="column.key === 'created_time'">
          <p class="whitespace-nowrap">{{ formatDateTime(row.created_time) }}</p>
        </template>

        <!-- 过期时间 -->
        <template v-else-if="column.key === 'expired_time'">
          <span class="whitespace-nowrap" :class="row.expired_time === -1 ? 'text-fg-subtle' : ''">
            {{
              row.expired_time === -1
                ? t('keys.never')
                : formatDateTime(row.expired_time)
            }}
          </span>
        </template>

        <!-- 最后使用：与创建时间相同说明从未用过 -->
        <template v-else-if="column.key === 'accessed_time'">
          <span class="whitespace-nowrap" :class="row.accessed_time <= row.created_time ? 'text-fg-subtle' : ''">
            {{
              row.accessed_time <= row.created_time
                ? t('keys.neverUsed')
                : formatRelative(row.accessed_time)
            }}
          </span>
        </template>

        <!-- 操作 -->
        <template v-else-if="column.key === 'actions'">
          <div class="flex items-center justify-end gap-1">
            <button
              type="button"
              class="motion-press whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[12px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
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
              {{ row.status === TOKEN_STATUS.ENABLED ? t('keys.disable') : t('keys.enable') }}
            </button>
            <button
              type="button"
              class="motion-press whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[12px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg disabled:opacity-50"
              :title="t('ccswitch.action')"
              :disabled="ccLoading === row.id"
              @click="openCcSwitch(row)"
            >
              {{ t('ccswitch.actionShort') }}
            </button>
            <button
              type="button"
              class="motion-press whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[12px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
              @click="openEdit(row)"
            >
              {{ t('common.edit') }}
            </button>
            <button
              type="button"
              class="motion-press whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[12px] text-fg-muted transition-colors hover:border-danger-border hover:bg-danger-bg hover:text-danger-fg"
              @click="delTarget = row"
            >
              {{ t('common.delete') }}
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

    <!-- 分组列的内联编辑弹层（teleport 到 body，避开表格的 overflow 裁切） -->
    <TokenGroupsPopover
      v-model:groups="groupPopDraft"
      v-model:retry="groupPopRetry"
      :open="groupPopRow != null"
      :anchor="groupPopAnchor"
      :options="groupOptions"
      :meta="groupsQ.data.value"
      :counts="groupCounts"
      :models="groupModels"
      :saving="groupMut.isPending.value"
      @close="closeGroupPop"
      @save="submitGroupPop"
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
          <GroupSelector
            v-model="form.groups"
            :options="groupOptions"
            :meta="groupsQ.data.value"
            :counts="groupCounts"
            :models="groupModels"
          />
        </FormField>

        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-[12.5px] font-medium text-fg">{{ t('keys.crossGroupRetry') }}</p>
            <p class="mt-1 text-[11.5px] text-fg-subtle">{{ t('keys.crossGroupHint') }}</p>
          </div>
          <AppSwitch v-model="form.cross_group_retry" :label="t('keys.crossGroupRetry')" />
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

    <!-- 填入 CC Switch -->
    <CcSwitchModal
      :open="ccOpen"
      :token-key="ccKey"
      :token-name="ccName"
      :models="modelsQ.data.value ?? []"
      @close="ccOpen = false"
      @opened="toast(t('ccswitch.opened'))"
    />

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
