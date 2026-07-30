<script setup lang="ts">
/**
 * 额度与限制。对齐 infron 的 Quota Limit 页形态（当前吞吐 + 每密钥上限表）。
 *
 * ⚠️ 一处能力差异，必须如实呈现：
 * infron 让用户自己设 RPM/TPM，我们后端的请求限流是**站点级/分组级**配置
 * （setting.ModelRequestRateLimitGroup，仅管理员可改，无任何用户端读写接口）。
 * 所以这里不做假的限流输入框 —— 画一个能改却不生效的表单是最糟的选择。
 *
 * 用户真正能自己控制的是每把密钥的额度上限（token.remain_quota /
 * unlimited_quota），那是本页的主体；RPM/TPM 只做实时观测（/log/self/stat）。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import { Activity, Gauge, Infinity as InfinityIcon, KeyRound, Wallet } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { listTokens, parseTokenGroups, updateToken } from '@/api/tokens'
import { getLogStat } from '@/api/usage'
import { TOKEN_STATUS, type ApiToken } from '@/api/types'
import { formatCompact, formatInt, formatQuota, quotaToUsd } from '@/lib/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatCard from '@/components/ui/StatCard.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import FormField from '@/components/ui/FormField.vue'

const site = useSiteStore()
const userStore = useUserStore()
const { quotaPerUnit } = storeToRefs(site)
const { user } = storeToRefs(userStore)
const { t } = useI18n()
const qc = useQueryClient()

/** 实时吞吐。后端按最近一分钟算，与任何时间窗无关，故 30s 轮询一次 */
const statQ = useQuery({
  queryKey: ['log-stat-live'],
  queryFn: () => getLogStat({}),
  refetchInterval: 30_000,
})

const tokensQ = useQuery({
  queryKey: ['tokens', 'all-for-limits'],
  // 这一页要看全部密钥的上限，不分页；100 是后端单页上限
  queryFn: () => listTokens({ p: 1, page_size: 100 }),
})

const tokens = computed(() => tokensQ.data.value?.items ?? [])

const accountQuota = computed(() => user.value?.quota ?? 0)
const accountUsed = computed(() => user.value?.used_quota ?? 0)

/**
 * 已分配上限合计。只统计「有限额且启用」的密钥 ——
 * 无限额密钥无法计入总和，单独计数展示。
 */
const allocated = computed(() =>
  tokens.value
    .filter((k) => !k.unlimited_quota)
    .reduce((sum, k) => sum + Math.max(0, k.remain_quota), 0),
)
const unlimitedCount = computed(() => tokens.value.filter((k) => k.unlimited_quota).length)

/**
 * 超额分配警告：无限额密钥能花光整个账户余额，
 * 有限额密钥的上限之和也可能超过余额。两种情况都值得提醒。
 */
const overAllocated = computed(
  () => unlimitedCount.value === 0 && allocated.value > accountQuota.value,
)

const columns = computed<Column<ApiToken>[]>(() => [
  { key: 'name', label: t('limits.colKey') },
  { key: 'status', label: t('limits.colStatus'), class: 'w-[90px]' },
  { key: 'limit', label: t('limits.colLimit'), class: 'w-[150px]', numeric: true },
  { key: 'used', label: t('limits.colUsed'), class: 'w-[130px]', numeric: true },
  { key: 'progress', label: t('limits.colProgress'), class: 'w-[160px]' },
  { key: 'actions', label: '', class: 'w-[80px]' },
])

/** 用量占上限的比例。无限额时返回 null（没有分母，不该画进度条） */
function usedRatio(k: ApiToken): number | null {
  if (k.unlimited_quota) return null
  const cap = k.remain_quota + k.used_quota
  if (cap <= 0) return null
  return Math.min(1, k.used_quota / cap)
}

// ───────────────── 编辑上限 ─────────────────

const editing = ref<ApiToken | null>(null)
const formUnlimited = ref(false)
const formQuotaUsd = ref('')
const formError = ref<string | null>(null)

function openEdit(k: ApiToken) {
  editing.value = k
  formUnlimited.value = k.unlimited_quota
  formQuotaUsd.value = k.unlimited_quota
    ? ''
    : String(quotaToUsd(k.remain_quota, quotaPerUnit.value))
  formError.value = null
}

const saveMut = useMutation({
  mutationFn: async () => {
    const k = editing.value
    if (!k) throw new Error('no token')

    let remain = k.remain_quota
    if (!formUnlimited.value) {
      const usd = Number(formQuotaUsd.value)
      if (!Number.isFinite(usd) || usd < 0) throw new Error(t('limits.errAmount'))
      remain = Math.round(usd * quotaPerUnit.value)
    }

    /**
     * PUT /api/token/ 是全量更新（非 status_only 时会覆盖所有字段），
     * 故必须把现有值原样回填，否则会把模型限制、IP 白名单等清空。
     */
    return updateToken({
      id: k.id,
      name: k.name,
      expired_time: k.expired_time,
      remain_quota: remain,
      unlimited_quota: formUnlimited.value,
      model_limits_enabled: k.model_limits_enabled,
      model_limits: k.model_limits,
      allow_ips: k.allow_ips || null,
      cross_group_retry: k.cross_group_retry,
      groups: parseTokenGroups(k),
    })
  },
  onSuccess: () => {
    toast.success(t('limits.saved'))
    editing.value = null
    qc.invalidateQueries({ queryKey: ['tokens'] })
  },
  onError: (e: Error) => {
    formError.value = e.message
  },
})
</script>

<template>
  <div>
    <PageHeader :title="t('limits.title')" :description="t('limits.subtitle')" />

    <!-- 实时观测 + 账户额度 -->
    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        :label="t('limits.rpm')"
        :value="formatInt(statQ.data.value?.rpm ?? 0)"
        :hint="t('limits.lastMinute')"
        :icon="Activity"
        :loading="statQ.isLoading.value"
      />
      <StatCard
        :label="t('limits.tpm')"
        :value="formatCompact(statQ.data.value?.tpm ?? 0)"
        :hint="t('limits.lastMinute')"
        :icon="Gauge"
        :loading="statQ.isLoading.value"
      />
      <StatCard
        :label="t('limits.balance')"
        :value="formatQuota(accountQuota, quotaPerUnit)"
        :hint="t('limits.usedTotal', { v: formatQuota(accountUsed, quotaPerUnit) })"
        :icon="Wallet"
      />
      <StatCard
        :label="t('limits.allocated')"
        :value="
          unlimitedCount > 0
            ? t('limits.hasUnlimited', { n: unlimitedCount })
            : formatQuota(allocated, quotaPerUnit)
        "
        :hint="t('limits.acrossKeys', { n: tokens.length })"
        :icon="KeyRound"
        :loading="tokensQ.isLoading.value"
      />
    </div>

    <!-- 超额分配提醒 -->
    <div
      v-if="overAllocated"
      class="mb-4 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-[12.5px] text-warning-fg"
    >
      {{
        t('limits.overAllocated', {
          allocated: formatQuota(allocated, quotaPerUnit),
          balance: formatQuota(accountQuota, quotaPerUnit),
        })
      }}
    </div>

    <!-- 站点限流说明：如实说明这是服务端配置，不是可改项 -->
    <div
      class="mb-6 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-[12.5px] leading-relaxed text-fg-muted"
    >
      {{ t('limits.serverSideNotice') }}
    </div>

    <h2 class="mb-3 text-[15px] font-semibold tracking-tight">
      {{ t('limits.perKeyTitle') }}
    </h2>

    <DataTable
      :columns="columns"
      :rows="tokens"
      :row-key="(r) => r.id"
      :loading="tokensQ.isLoading.value"
      :error="tokensQ.error.value ? String(tokensQ.error.value.message) : null"
      :skeleton-rows="4"
      @retry="tokensQ.refetch()"
    >
      <template #empty>
        <KeyRound class="mx-auto size-7 text-fg-subtle" />
        <p class="mt-3 text-[13.5px] font-medium">{{ t('limits.emptyTitle') }}</p>
        <p class="mt-1 text-[12.5px] text-fg-subtle">{{ t('limits.emptyDesc') }}</p>
        <RouterLink
          to="/console/keys"
          class="mt-3 inline-flex h-8 items-center rounded-lg bg-btn-primary-bg px-3 text-[12.5px] font-medium text-btn-primary-fg transition-colors hover:bg-btn-primary-hover"
        >
          {{ t('limits.createKey') }}
        </RouterLink>
      </template>

      <template #cell="{ row, column }">
        <template v-if="column.key === 'name'">
          <p class="truncate font-medium">{{ row.name || t('limits.unnamed') }}</p>
          <p class="mt-0.5 truncate text-[11px] text-fg-subtle">
            {{ parseTokenGroups(row).join(', ') || '—' }}
          </p>
        </template>

        <template v-else-if="column.key === 'status'">
          <span
            class="inline-flex rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium"
            :class="
              row.status === TOKEN_STATUS.ENABLED
                ? 'border-success-border bg-success-bg text-success-fg'
                : 'border-border bg-bg-muted text-fg-muted'
            "
          >
            {{ t(`keys.status_${row.status}`) }}
          </span>
        </template>

        <template v-else-if="column.key === 'limit'">
          <span v-if="row.unlimited_quota" class="inline-flex items-center gap-1">
            <InfinityIcon class="size-3.5 text-fg-subtle" />
            {{ t('limits.unlimited') }}
          </span>
          <span v-else>{{ formatQuota(row.remain_quota, quotaPerUnit) }}</span>
        </template>

        <template v-else-if="column.key === 'used'">
          {{ formatQuota(row.used_quota, quotaPerUnit) }}
        </template>

        <template v-else-if="column.key === 'progress'">
          <div v-if="usedRatio(row) !== null" class="flex items-center gap-2">
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-inset">
              <div
                class="h-full rounded-full transition-all"
                :class="
                  usedRatio(row)! > 0.9
                    ? 'bg-danger-fg'
                    : usedRatio(row)! > 0.7
                      ? 'bg-warning-fg'
                      : 'bg-accent'
                "
                :style="{ width: `${Math.max(2, usedRatio(row)! * 100)}%` }"
              />
            </div>
            <span class="w-9 shrink-0 text-right text-[11px] tabular text-fg-subtle">
              {{ Math.round(usedRatio(row)! * 100) }}%
            </span>
          </div>
          <span v-else class="text-[11.5px] text-fg-subtle">
            {{ t('limits.noCap') }}
          </span>
        </template>

        <template v-else-if="column.key === 'actions'">
          <AppButton size="sm" variant="ghost" @click="openEdit(row)">
            {{ t('common.edit') }}
          </AppButton>
        </template>
      </template>
    </DataTable>

    <!-- 编辑上限 -->
    <AppModal
      :open="editing !== null"
      :title="t('limits.editTitle')"
      :description="editing?.name || undefined"
      @close="editing = null"
    >
      <div class="space-y-4">
        <label class="flex items-start gap-2.5">
          <input
            v-model="formUnlimited"
            type="checkbox"
            class="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--color-accent)]"
          />
          <span>
            <span class="block text-[13px] font-medium">{{ t('limits.unlimited') }}</span>
            <span class="mt-0.5 block text-[11.5px] text-fg-subtle">
              {{ t('limits.unlimitedHint') }}
            </span>
          </span>
        </label>

        <FormField
          v-if="!formUnlimited"
          id="limit-amount"
          :label="t('limits.amountLabel')"
          :hint="t('limits.amountHint')"
          :error="formError"
        >
          <div class="relative">
            <span
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-subtle"
            >
              $
            </span>
            <input
              id="limit-amount"
              v-model="formQuotaUsd"
              type="number"
              min="0"
              step="0.01"
              class="h-9 w-full rounded-lg border border-border bg-bg pl-7 pr-3 text-[13px] tabular outline-none transition-colors focus:border-accent"
            />
          </div>
        </FormField>

        <p v-if="formError && formUnlimited" class="text-[11.5px] text-danger-fg">
          {{ formError }}
        </p>
      </div>

      <template #footer>
        <AppButton variant="ghost" @click="editing = null">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          variant="primary"
          :loading="saveMut.isPending.value"
          @click="saveMut.mutate()"
        >
          {{ t('common.save') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
