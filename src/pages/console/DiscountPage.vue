<script setup lang="ts">
/**
 * 优惠。infron 的 Discount 页是「阶梯折扣 + 邀请返利」形态，
 * 我们后端刚好有四类真实优惠，全部聚在这里：
 *
 *   1. 充值折扣  /user/topup/info 的 discount：{ 金额: 倍率 }
 *      ⚠️ 后端是**精确金额匹配**（topUpDiscount 直接查 map），不是阶梯 ——
 *         充 99 不会套用 100 的折扣。故 UI 必须强调「充指定金额」。
 *   2. 分组倍率  /user/self/groups：倍率越低越便宜
 *   3. 邀请返利  /user/aff + user.aff_count/aff_quota + 转入额度
 *   4. 每日签到  /user/checkin（站点可关）
 *
 * 哪块没有数据就整块不渲染 —— 空的优惠卡片比没有更糟。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  BadgePercent,
  CalendarCheck,
  Check,
  Copy,
  Gift,
  Layers,
  Users,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { getTopUpInfo } from '@/api/billing'
import { getMyGroups } from '@/api/models'
import { doCheckin, getAffCode, getCheckin, transferAffQuota } from '@/api/account'
import { formatPercent, formatQuota, quotaToUsd } from '@/lib/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import FormField from '@/components/ui/FormField.vue'

const site = useSiteStore()
const userStore = useUserStore()
const { quotaPerUnit } = storeToRefs(site)
const { user } = storeToRefs(userStore)
const { t } = useI18n()
const qc = useQueryClient()

const infoQ = useQuery({ queryKey: ['topup-info'], queryFn: getTopUpInfo })
const groupsQ = useQuery({ queryKey: ['my-groups'], queryFn: getMyGroups })
const checkinQ = useQuery({ queryKey: ['checkin'], queryFn: () => getCheckin() })

/**
 * 邀请返利暂不对外开放，整块隐藏。
 * 后端能力还在，改成 true 就能原样恢复（邀请码请求也跟着开关走，关掉时不发）。
 */
const SHOW_AFFILIATE = false

/** 邀请码惰性生成：已有就用 user.aff_code，没有才调接口 */
const affQ = useQuery({
  queryKey: ['aff-code'],
  queryFn: getAffCode,
  enabled: computed(() => SHOW_AFFILIATE && !user.value?.aff_code),
})
const affCode = computed(() =>
  SHOW_AFFILIATE ? user.value?.aff_code || affQ.data.value || '' : '',
)

const affLink = computed(() =>
  affCode.value
    ? `${window.location.origin}/register?aff=${encodeURIComponent(affCode.value)}`
    : '',
)

// ───────────────── 充值折扣 ─────────────────

/**
 * discount 是 { 金额: 倍率 }，倍率 <1 才是优惠。
 * 后端把 =1 的都归一成 1，所以这里过滤掉无优惠项。
 */
const discountTiers = computed(() => {
  const d = infoQ.data.value?.discount ?? {}
  return Object.entries(d)
    .map(([amount, ratio]) => ({ amount: Number(amount), ratio: Number(ratio) }))
    .filter((x) => Number.isFinite(x.amount) && x.ratio > 0 && x.ratio < 1)
    .sort((a, b) => a.amount - b.amount)
})

// ───────────────── 分组倍率 ─────────────────

/** 倍率是字符串时说明是 auto 分组（运行时决定），单独标注 */
const groupTiers = computed(() => {
  const g = groupsQ.data.value ?? {}
  return Object.entries(g).map(([key, v]) => ({
    key,
    desc: v.desc,
    ratio: typeof v.ratio === 'number' ? v.ratio : null,
    ratioLabel: typeof v.ratio === 'number' ? `×${v.ratio}` : String(v.ratio),
  }))
})

const currentGroup = computed(() => user.value?.group ?? '')

// ───────────────── 签到 ─────────────────

const checkinInfo = computed(() => checkinQ.data.value ?? null)
const checkinEnabled = computed(() => checkinInfo.value?.enabled === true)
const checkedToday = computed(
  () => checkinInfo.value?.stats?.checked_in_today === true,
)

const checkinMut = useMutation({
  mutationFn: doCheckin,
  onSuccess: async (d) => {
    toast.success(
      t('discount.checkinSuccess', {
        v: formatQuota(d?.quota_awarded ?? 0, quotaPerUnit.value),
      }),
    )
    await Promise.all([
      userStore.fetchSelf(),
      qc.invalidateQueries({ queryKey: ['checkin'] }),
    ])
  },
  onError: (e: Error) => toast.error(e.message),
})

// ───────────────── 邀请返利 ─────────────────

const copied = ref(false)
async function copyLink() {
  if (!affLink.value) return
  try {
    await navigator.clipboard.writeText(affLink.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast.error(t('keys.copyFailed'))
  }
}

const transferOpen = ref(false)
const transferUsd = ref('')
const affQuota = computed(() => user.value?.aff_quota ?? 0)

const transferMut = useMutation({
  mutationFn: () => {
    const usd = Number(transferUsd.value)
    if (!Number.isFinite(usd) || usd <= 0) throw new Error(t('discount.errAmount'))
    const quota = Math.round(usd * quotaPerUnit.value)
    if (quota > affQuota.value) throw new Error(t('discount.errExceeds'))
    return transferAffQuota(quota)
  },
  onSuccess: async () => {
    toast.success(t('discount.transferred'))
    transferOpen.value = false
    transferUsd.value = ''
    await userStore.fetchSelf()
  },
  onError: (e: Error) => toast.error(e.message),
})

const hasAnything = computed(
  () =>
    discountTiers.value.length > 0 ||
    groupTiers.value.length > 0 ||
    checkinEnabled.value ||
    Boolean(affCode.value),
)
</script>

<template>
  <div>
    <PageHeader :title="t('discount.title')" :description="t('discount.subtitle')" />

    <!-- 充值折扣 -->
    <section v-if="discountTiers.length" class="mb-8">
      <div class="mb-3 flex items-center gap-2">
        <BadgePercent class="size-4 text-fg-subtle" />
        <h2 class="text-[15px] font-semibold tracking-tight">
          {{ t('discount.topupTitle') }}
        </h2>
      </div>
      <p class="mb-3 text-[12.5px] leading-relaxed text-fg-muted">
        {{ t('discount.topupDesc') }}
      </p>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="tier in discountTiers"
          :key="tier.amount"
          class="relative overflow-hidden rounded-xl border border-border bg-bg-elevated p-4"
        >
          <span
            class="absolute right-3 top-3 rounded-full border border-success-border bg-success-bg px-1.5 py-0.5 text-[10.5px] font-medium text-success-fg"
          >
            {{ t('discount.off', { p: formatPercent(1 - tier.ratio, 0) }) }}
          </span>
          <p class="text-[11.5px] uppercase tracking-wide text-fg-subtle">
            {{ t('discount.topUpExactly') }}
          </p>
          <p class="mt-1 text-[22px] font-semibold tabular">${{ tier.amount }}</p>
          <p class="mt-1.5 text-[12.5px] text-fg-muted">
            {{
              t('discount.payOnly', {
                v: `$${(tier.amount * tier.ratio).toFixed(2)}`,
              })
            }}
          </p>
        </article>
      </div>

      <RouterLink
        to="/console/billing"
        class="mt-3 inline-flex h-9 items-center rounded-lg bg-btn-primary-bg px-3.5 text-[13px] font-medium text-btn-primary-fg transition-colors hover:bg-btn-primary-hover"
      >
        {{ t('discount.goTopUp') }}
      </RouterLink>
    </section>

    <!-- 分组倍率 -->
    <section v-if="groupTiers.length" class="mb-8">
      <div class="mb-3 flex items-center gap-2">
        <Layers class="size-4 text-fg-subtle" />
        <h2 class="text-[15px] font-semibold tracking-tight">
          {{ t('discount.groupTitle') }}
        </h2>
      </div>
      <p class="mb-3 text-[12.5px] leading-relaxed text-fg-muted">
        {{ t('discount.groupDesc') }}
      </p>

      <div class="divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-elevated">
        <div
          v-for="g in groupTiers"
          :key="g.key"
          class="flex flex-wrap items-center gap-3 px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-2 text-[13px] font-medium">
              {{ g.key }}
              <span
                v-if="g.key === currentGroup"
                class="rounded-full border border-accent-border bg-accent-bg px-1.5 py-0.5 text-[10px] font-medium text-accent"
              >
                {{ t('discount.yourGroup') }}
              </span>
            </p>
            <p v-if="g.desc" class="mt-0.5 text-[11.5px] text-fg-subtle">{{ g.desc }}</p>
          </div>
          <span class="shrink-0 text-[13px] font-medium tabular">{{ g.ratioLabel }}</span>
        </div>
      </div>
      <p class="mt-2 text-[11.5px] text-fg-subtle">{{ t('discount.groupNote') }}</p>
    </section>

    <!-- 签到 -->
    <section v-if="checkinEnabled" class="mb-8">
      <div class="mb-3 flex items-center gap-2">
        <CalendarCheck class="size-4 text-fg-subtle" />
        <h2 class="text-[15px] font-semibold tracking-tight">
          {{ t('discount.checkinTitle') }}
        </h2>
      </div>

      <div
        class="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-bg-elevated p-5"
      >
        <div class="min-w-0 flex-1">
          <p class="text-[13px]">
            {{
              t('discount.checkinRange', {
                min: formatQuota(checkinInfo?.min_quota ?? 0, quotaPerUnit),
                max: formatQuota(checkinInfo?.max_quota ?? 0, quotaPerUnit),
              })
            }}
          </p>
          <p class="mt-1 text-[12px] text-fg-subtle">
            {{
              t('discount.checkinStats', {
                days: checkinInfo?.stats?.total_checkins ?? 0,
                total: formatQuota(checkinInfo?.stats?.total_quota ?? 0, quotaPerUnit),
              })
            }}
          </p>
        </div>
        <AppButton
          variant="primary"
          :disabled="checkedToday"
          :loading="checkinMut.isPending.value"
          @click="checkinMut.mutate()"
        >
          <Gift class="size-3.5" />
          {{ checkedToday ? t('discount.checkedIn') : t('discount.checkinNow') }}
        </AppButton>
      </div>
    </section>

    <!-- 邀请返利 -->
    <section v-if="SHOW_AFFILIATE && affCode" class="mb-8">
      <div class="mb-3 flex items-center gap-2">
        <Users class="size-4 text-fg-subtle" />
        <h2 class="text-[15px] font-semibold tracking-tight">
          {{ t('discount.affTitle') }}
        </h2>
      </div>
      <p class="mb-3 text-[12.5px] leading-relaxed text-fg-muted">
        {{ t('discount.affDesc') }}
      </p>

      <div class="rounded-xl border border-border bg-bg-elevated p-5">
        <div class="flex flex-wrap items-end gap-6">
          <div>
            <p class="text-[11.5px] uppercase tracking-wide text-fg-subtle">
              {{ t('discount.affCount') }}
            </p>
            <p class="mt-1 text-[20px] font-semibold tabular">
              {{ user?.aff_count ?? 0 }}
            </p>
          </div>
          <div>
            <p class="text-[11.5px] uppercase tracking-wide text-fg-subtle">
              {{ t('discount.affQuota') }}
            </p>
            <p class="mt-1 text-[20px] font-semibold tabular">
              {{ formatQuota(affQuota, quotaPerUnit) }}
            </p>
          </div>
          <AppButton
            v-if="affQuota > 0"
            class="mb-1"
            @click="transferOpen = true"
          >
            {{ t('discount.transfer') }}
          </AppButton>
        </div>

        <div class="mt-4">
          <p class="mb-1.5 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            {{ t('discount.affLink') }}
          </p>
          <div class="flex items-center gap-2">
            <code
              class="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-subtle px-3 py-2 font-mono text-[12px]"
            >
              {{ affLink }}
            </code>
            <button
              type="button"
              class="shrink-0 rounded-lg border border-border p-2 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :aria-label="t('common.copy')"
              @click="copyLink"
            >
              <Check v-if="copied" class="size-4 text-success-fg" />
              <Copy v-else class="size-4" />
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 全无优惠：如实说明，不画空卡 -->
    <div
      v-if="!hasAnything && !infoQ.isLoading.value && !groupsQ.isLoading.value"
      class="rounded-xl border border-border bg-bg-elevated px-4 py-16 text-center"
    >
      <BadgePercent class="mx-auto size-7 text-fg-subtle" />
      <p class="mt-3 text-[13.5px] font-medium">{{ t('discount.emptyTitle') }}</p>
      <p class="mt-1 text-[12.5px] text-fg-subtle">{{ t('discount.emptyDesc') }}</p>
    </div>

    <!-- 返利转入 -->
    <AppModal
      :open="transferOpen"
      :title="t('discount.transferTitle')"
      :description="
        t('discount.transferDesc', { v: formatQuota(affQuota, quotaPerUnit) })
      "
      @close="transferOpen = false"
    >
      <FormField
        id="transfer-amount"
        :label="t('discount.transferLabel')"
        :hint="t('discount.transferHint', { max: quotaToUsd(affQuota, quotaPerUnit) })"
        required
      >
        <div class="relative">
          <span
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-subtle"
          >
            $
          </span>
          <input
            id="transfer-amount"
            v-model="transferUsd"
            type="number"
            min="0"
            step="0.01"
            :max="quotaToUsd(affQuota, quotaPerUnit)"
            class="h-9 w-full rounded-lg border border-border bg-bg pl-7 pr-3 text-[13px] tabular outline-none transition-colors focus:border-border-selected"
          />
        </div>
      </FormField>
      <template #footer>
        <AppButton variant="ghost" @click="transferOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          variant="primary"
          :loading="transferMut.isPending.value"
          @click="transferMut.mutate()"
        >
          {{ t('discount.transferSubmit') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
