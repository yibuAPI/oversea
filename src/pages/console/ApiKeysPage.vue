<script setup lang="ts">
/**
 * API 密钥。对齐 infron API Keys 页的表格结构（名称/状态/创建时间/最后使用/操作），
 * 但字段以后端真实能力为准：
 *   - key 列表里是打码的，明文要单独点「显示」调 /token/:id/key
 *   - 创建接口不返回 data，故建完必须重新拉列表
 *   - 分组是必填项（后端按 groups 路由），下拉数据来自 /user/self/groups
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import {
  Plus,
  Copy,
  Eye,
  Trash2,
  Pencil,
  KeyRound,
  Check,
  Ban,
  CircleCheck,
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
import { getMyGroups, getMyModels } from '@/api/models'
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
const PAGE_SIZE = 10

const tokensQ = useQuery({
  queryKey: computed(() => ['tokens', page.value]),
  queryFn: () => listTokens({ p: page.value, page_size: PAGE_SIZE }),
})

const groupsQ = useQuery({ queryKey: ['my-groups'], queryFn: getMyGroups })
const modelsQ = useQuery({ queryKey: ['my-models'], queryFn: () => getMyModels() })

const rows = computed(() => tokensQ.data.value?.items ?? [])

const columns: Column<ApiToken>[] = [
  { key: 'name', label: t('keys.colName') },
  { key: 'key', label: t('keys.colKey'), class: 'w-[210px]' },
  { key: 'status', label: t('keys.colStatus'), class: 'w-[100px]' },
  { key: 'quota', label: t('keys.colUsage'), class: 'w-[130px]', numeric: true },
  { key: 'created_time', label: t('keys.colCreated'), class: 'w-[150px]' },
  { key: 'accessed_time', label: t('keys.colLastUsed'), class: 'w-[120px]' },
  { key: 'actions', label: '', class: 'w-[120px]' },
]

// ───────────────── 明文密钥 ─────────────────

/** id -> 明文。只在本次会话内存在，不落盘 */
const revealed = ref<Record<number, string>>({})
const revealing = ref<number | null>(null)

async function onReveal(id: number) {
  if (revealed.value[id]) return
  revealing.value = id
  try {
    const { key } = await revealTokenKey(id)
    revealed.value = { ...revealed.value, [id]: key }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), true)
  } finally {
    revealing.value = null
  }
}

/** 完整密钥要带 sk- 前缀才能直接用于 Authorization */
function fullKey(id: number) {
  const raw = revealed.value[id]
  return raw ? `sk-${raw}` : null
}

async function onCopy(id: number) {
  // 没显示过就先取一次，省得用户点两下
  if (!revealed.value[id]) await onReveal(id)
  const k = fullKey(id)
  if (!k) return
  try {
    await navigator.clipboard.writeText(k)
    toast(t('keys.copied'))
  } catch {
    toast(t('keys.copyFailed'), true)
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
      cross_group_retry: false,
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
  <div>
    <PageHeader :title="t('keys.title')" :description="t('keys.subtitle')">
      <template #actions>
        <AppButton variant="primary" @click="openCreate">
          <Plus class="size-3.5" />
          {{ t('keys.add') }}
        </AppButton>
      </template>
    </PageHeader>

    <DataTable
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
        <!-- 名称 + 分组 -->
        <template v-if="column.key === 'name'">
          <p class="truncate font-medium">{{ row.name }}</p>
          <p class="mt-0.5 truncate text-[11.5px] text-fg-subtle">
            {{ parseTokenGroups(row).join(', ') || '—' }}
            <template v-if="row.model_limits_enabled">
              · {{ t('keys.modelLimited') }}
            </template>
          </p>
        </template>

        <!-- 密钥 -->
        <template v-else-if="column.key === 'key'">
          <div class="flex items-center gap-1">
            <code class="min-w-0 flex-1 truncate font-mono text-[11.5px]">
              {{ fullKey(row.id) ?? `sk-${row.key}` }}
            </code>
            <button
              v-if="!revealed[row.id]"
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg disabled:opacity-50"
              :title="t('keys.reveal')"
              :aria-label="t('keys.reveal')"
              :disabled="revealing === row.id"
              @click="onReveal(row.id)"
            >
              <Eye class="size-3.5" />
            </button>
            <button
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :title="t('common.copy')"
              :aria-label="t('common.copy')"
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
      :page-size="tokensQ.data.value?.page_size || PAGE_SIZE"
      :total="tokensQ.data.value?.total ?? 0"
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
            class="h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          />
        </FormField>

        <FormField id="k-group" :label="t('keys.fGroup')" :hint="t('keys.fGroupHint')" required>
          <select
            id="k-group"
            v-model="form.groups[0]"
            class="h-9 w-full rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none transition-colors focus:border-accent"
          >
            <option v-for="g in groupOptions" :key="g" :value="g">
              {{ g }}
              <template v-if="groupsQ.data.value?.[g]">
                （×{{ groupsQ.data.value[g]!.ratio }}）
              </template>
            </option>
          </select>
        </FormField>

        <FormField id="k-expiry" :label="t('keys.fExpiry')">
          <select
            id="k-expiry"
            v-model="form.expiry"
            class="h-9 w-full rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none transition-colors focus:border-accent"
          >
            <option v-for="p in EXPIRY_PRESETS" :key="p.value" :value="p.value">
              {{ t(`keys.expiry_${p.value}`) }}
            </option>
          </select>
          <input
            v-if="form.expiry === 'custom'"
            v-model="form.customExpiry"
            type="datetime-local"
            class="mt-2 h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-accent"
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
                class="h-9 w-full rounded-lg border border-border bg-bg pl-6 pr-3 text-[13px] tabular outline-none transition-colors focus:border-accent"
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
            class="mt-2 w-full rounded-lg border border-border bg-bg p-1.5 text-[12.5px] outline-none transition-colors focus:border-accent"
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
            class="h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-[12.5px] outline-none transition-colors focus:border-accent"
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
