<script setup lang="ts">
/**
 * 账单与充值。合并 infron 的 Billing Transactions + Payments 两页：
 * 上半是充值入口（按后端真实开启的通道渲染），下半是交易流水。
 *
 * 支付通道有五种，全部由 /api/user/topup/info 的开关决定，
 * 一个没开就只显示兑换码 —— 绝不画点了会报错的按钮：
 *   enable_online_topup  易支付：返回表单字段，需前端构造 form POST
 *   enable_stripe_topup  Stripe：返回 pay_link，直接跳
 *   enable_creem_topup   Creem：预设商品，返回 checkout_url
 *   enable_usdt_topup    USDT：返回钱包地址，需轮询到账
 *   enable_redemption    兑换码：走标准 envelope
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  ArrowUpRight,
  Copy,
  CreditCard,
  Gift,
  Receipt,
  Wallet,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import {
  calcAmount,
  getTopUpInfo,
  getUsdtStatus,
  listTopUps,
  parseCreemProducts,
  payCreem,
  payEpay,
  payStripe,
  payUsdt,
  redeemCode,
} from '@/api/billing'
import type { TopUpRecord } from '@/api/types'
import { formatDateTime, formatQuota, formatUsd } from '@/lib/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatCard from '@/components/ui/StatCard.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
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

const page = ref(1)
const PAGE_SIZE = 10
const recordsQ = useQuery({
  queryKey: computed(() => ['topups', page.value]),
  queryFn: () => listTopUps({ p: page.value, page_size: PAGE_SIZE }),
})

const info = computed(() => infoQ.data.value ?? null)
const creemProducts = computed(() => parseCreemProducts(info.value))

/** 任一在线通道开着 */
const anyOnline = computed(
  () =>
    info.value?.enable_online_topup ||
    info.value?.enable_stripe_topup ||
    info.value?.enable_creem_topup ||
    info.value?.enable_usdt_topup,
)

/** 快捷金额。后端可配 amount_options，没配就用一组常见档位 */
const amountOptions = computed(() =>
  info.value?.amount_options?.length ? info.value.amount_options : [5, 10, 20, 50, 100],
)

// ───────────────── 充值金额与试算 ─────────────────

const amount = ref<number>(0)
const minTopup = computed(() => info.value?.min_topup ?? 1)

/** 后端试算的实付价（含折扣），只在有在线通道且金额合法时问 */
const quoteQ = useQuery({
  queryKey: computed(() => ['topup-quote', amount.value]),
  queryFn: () => calcAmount(amount.value),
  enabled: computed(
    () => Boolean(anyOnline.value) && amount.value >= minTopup.value,
  ),
})

const belowMin = computed(() => amount.value > 0 && amount.value < minTopup.value)

// ───────────────── 易支付 ─────────────────

/**
 * 易支付要求 form POST 而非跳转。动态建表单提交是唯一可行方式 ——
 * 后端返回的是待签名字段集，用 GET 拼 query 会丢签名。
 */
function submitEpayForm(url: string, fields: Record<string, string>) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = url
  form.target = '_blank'
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = k
    input.value = String(v)
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  form.remove()
}

const epayMethod = ref('alipay')

const epayMut = useMutation({
  mutationFn: () => payEpay(amount.value, epayMethod.value),
  onSuccess: (res) => {
    if (res.url) {
      submitEpayForm(res.url, res.data ?? {})
      toast.info(t('billing.newTabOpened'))
    } else {
      toast.error(t('billing.noPayUrl'))
    }
  },
  onError: (e: Error) => toast.error(e.message),
})

const stripeMut = useMutation({
  mutationFn: () =>
    payStripe({
      amount: amount.value,
      success_url: `${window.location.origin}/console/billing`,
      cancel_url: `${window.location.origin}/console/billing`,
    }),
  onSuccess: (d) => {
    if (d.pay_link) window.location.href = d.pay_link
    else toast.error(t('billing.noPayUrl'))
  },
  onError: (e: Error) => toast.error(e.message),
})

const creemMut = useMutation({
  mutationFn: (productId: string) => payCreem(productId),
  onSuccess: (d) => {
    if (d.checkout_url) window.location.href = d.checkout_url
    else toast.error(t('billing.noPayUrl'))
  },
  onError: (e: Error) => toast.error(e.message),
})

// ───────────────── USDT ─────────────────

/** USDT 是异步到账：拿到地址后要轮询状态 */
const usdtOrder = ref<{
  wallet_address: string
  usdt_amount: string
  trade_no: string
  expire_time: number
} | null>(null)

let pollTimer: ReturnType<typeof setInterval> | undefined
onUnmounted(() => clearInterval(pollTimer))

const usdtMut = useMutation({
  mutationFn: () => payUsdt(amount.value),
  onSuccess: (d) => {
    usdtOrder.value = d
    clearInterval(pollTimer)
    // 10s 一次足够：链上确认本身就要几十秒，轮太密只是浪费请求
    pollTimer = setInterval(async () => {
      const order = usdtOrder.value
      if (!order) return clearInterval(pollTimer)
      try {
        const res = await getUsdtStatus(order.trade_no)
        if (res.data?.status === 'success') {
          clearInterval(pollTimer)
          toast.success(t('billing.usdtPaid'))
          usdtOrder.value = null
          await Promise.all([userStore.fetchSelf(), qc.invalidateQueries()])
        }
      } catch {
        /* 轮询失败不打扰用户，下一轮再试 */
      }
    }, 10_000)
  },
  onError: (e: Error) => toast.error(e.message),
})

/** 订单过期倒计时 */
const nowTs = ref(Math.floor(Date.now() / 1000))
const tick = setInterval(() => (nowTs.value = Math.floor(Date.now() / 1000)), 1000)
onUnmounted(() => clearInterval(tick))

const usdtRemaining = computed(() => {
  if (!usdtOrder.value) return 0
  return Math.max(0, usdtOrder.value.expire_time - nowTs.value)
})
watch(usdtRemaining, (v) => {
  if (v === 0 && usdtOrder.value) {
    usdtOrder.value = null
    clearInterval(pollTimer)
  }
})

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('common.copied'))
  } catch {
    toast.error(t('keys.copyFailed'))
  }
}

// ───────────────── 兑换码 ─────────────────

const redeemOpen = ref(false)
const redeemKey = ref('')
const redeemMut = useMutation({
  mutationFn: () => redeemCode(redeemKey.value.trim()),
  onSuccess: async (added) => {
    toast.success(
      t('billing.redeemSuccess', { v: formatQuota(added ?? 0, quotaPerUnit.value) }),
    )
    redeemOpen.value = false
    redeemKey.value = ''
    // 余额和流水都变了
    await Promise.all([
      userStore.fetchSelf(),
      qc.invalidateQueries({ queryKey: ['topups'] }),
    ])
  },
  onError: (e: Error) => toast.error(e.message),
})

// ───────────────── 流水表 ─────────────────

const columns = computed<Column<TopUpRecord>[]>(() => [
  { key: 'create_time', label: t('billing.colTime'), class: 'w-[150px]' },
  { key: 'trade_no', label: t('billing.colOrder') },
  { key: 'payment_method', label: t('billing.colMethod'), class: 'w-[110px]' },
  { key: 'money', label: t('billing.colPaid'), class: 'w-[100px]', numeric: true },
  { key: 'quota', label: t('billing.colCredited'), class: 'w-[110px]', numeric: true },
  { key: 'status', label: t('billing.colStatus'), class: 'w-[90px]' },
])

const STATUS_CLASS: Record<string, string> = {
  success: 'border-success-border bg-success-bg text-success-fg',
  pending: 'border-warning-border bg-warning-bg text-warning-fg',
  failed: 'border-danger-border bg-danger-bg text-danger-fg',
  expired: 'border-border bg-bg-muted text-fg-muted',
}

/** 累计充值（本页可见部分），仅统计成功的 */
const totalTopUp = computed(() =>
  (recordsQ.data.value?.items ?? [])
    .filter((r) => r.status === 'success')
    .reduce((s, r) => s + r.quota, 0),
)
</script>

<template>
  <div>
    <PageHeader :title="t('billing.title')" :description="t('billing.subtitle')">
      <template #actions>
        <AppButton
          v-if="info?.enable_redemption"
          size="md"
          @click="redeemOpen = true"
        >
          <Gift class="size-3.5" />
          {{ t('billing.redeem') }}
        </AppButton>
      </template>
    </PageHeader>

    <div class="mb-6 grid gap-3 sm:grid-cols-3">
      <StatCard
        :label="t('billing.balance')"
        :value="formatQuota(user?.quota ?? 0, quotaPerUnit)"
        :icon="Wallet"
      />
      <StatCard
        :label="t('billing.lifetimeUsed')"
        :value="formatQuota(user?.used_quota ?? 0, quotaPerUnit)"
        :icon="Receipt"
      />
      <StatCard
        :label="t('billing.recentTopUp')"
        :value="formatQuota(totalTopUp, quotaPerUnit)"
        :hint="t('billing.recentHint')"
        :icon="ArrowUpRight"
        :loading="recordsQ.isLoading.value"
      />
    </div>

    <!-- 充值区 -->
    <section
      v-if="anyOnline || info?.enable_redemption"
      class="mb-8 rounded-xl border border-border bg-bg-elevated p-5"
    >
      <h2 class="text-[15px] font-semibold tracking-tight">
        {{ t('billing.addFunds') }}
      </h2>

      <template v-if="anyOnline">
        <!-- 金额选择 -->
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            v-for="a in amountOptions"
            :key="a"
            type="button"
            class="h-9 rounded-lg border px-3.5 text-[13px] font-medium tabular transition-colors"
            :class="
              amount === a
                ? 'border-accent bg-accent-bg text-accent'
                : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg'
            "
            @click="amount = a"
          >
            ${{ a }}
          </button>
          <div class="relative">
            <span
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-subtle"
            >
              $
            </span>
            <input
              v-model.number="amount"
              type="number"
              :min="minTopup"
              step="1"
              :aria-label="t('billing.customAmount')"
              :placeholder="t('billing.customAmount')"
              class="h-9 w-[130px] rounded-lg border border-border bg-bg pl-7 pr-3 text-[13px] tabular outline-none transition-colors focus:border-accent"
            />
          </div>
        </div>

        <p v-if="belowMin" class="mt-2 text-[12px] text-danger-fg">
          {{ t('billing.belowMin', { v: `$${minTopup}` }) }}
        </p>
        <p
          v-else-if="quoteQ.data.value && amount >= minTopup"
          class="mt-2 text-[12.5px] text-fg-muted"
        >
          {{ t('billing.quote', { amount: `$${amount}`, price: quoteQ.data.value }) }}
        </p>

        <!-- 支付通道 -->
        <div class="mt-4 flex flex-wrap gap-2">
          <!-- 易支付：需要选具体方式 -->
          <template v-if="info?.enable_online_topup">
            <select
              v-model="epayMethod"
              :aria-label="t('billing.epayMethod')"
              class="h-9 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-accent"
            >
              <option
                v-for="m in info.pay_methods ?? [{ name: '支付宝', type: 'alipay', color: '', min_topup: '1' }]"
                :key="m.type"
                :value="m.type"
              >
                {{ m.name }}
              </option>
            </select>
            <AppButton
              variant="primary"
              :disabled="amount < minTopup"
              :loading="epayMut.isPending.value"
              @click="epayMut.mutate()"
            >
              <CreditCard class="size-3.5" />
              {{ t('billing.payNow') }}
            </AppButton>
          </template>

          <AppButton
            v-if="info?.enable_stripe_topup"
            :disabled="amount < (info.stripe_min_topup ?? minTopup)"
            :loading="stripeMut.isPending.value"
            @click="stripeMut.mutate()"
          >
            {{ t('billing.payStripe') }}
          </AppButton>

          <AppButton
            v-if="info?.enable_usdt_topup"
            :disabled="amount < (info.usdt_min_topup ?? minTopup)"
            :loading="usdtMut.isPending.value"
            @click="usdtMut.mutate()"
          >
            {{ t('billing.payUsdt') }}
          </AppButton>
        </div>

        <!-- Creem 是固定商品，与自定义金额互斥，单独一块 -->
        <div v-if="info?.enable_creem_topup && creemProducts.length" class="mt-5">
          <p class="mb-2 text-[12.5px] text-fg-muted">{{ t('billing.creemPackages') }}</p>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="p in creemProducts"
              :key="p.productId"
              type="button"
              class="rounded-xl border border-border p-3 text-left transition-colors hover:border-accent hover:bg-bg-subtle"
              :disabled="creemMut.isPending.value"
              @click="creemMut.mutate(p.productId)"
            >
              <p class="text-[13px] font-medium">{{ p.name }}</p>
              <p class="mt-1 text-[16px] font-semibold tabular">
                {{ p.currency === 'USD' ? '$' : '' }}{{ p.price }}
              </p>
              <p class="mt-0.5 text-[11.5px] text-fg-subtle">
                {{ formatQuota(p.quota, quotaPerUnit) }}
                <template v-if="p.bonus">
                  · {{ t('billing.bonus', { v: formatQuota(p.bonus, quotaPerUnit) }) }}
                </template>
              </p>
            </button>
          </div>
        </div>
      </template>

      <p v-else class="mt-3 text-[12.5px] text-fg-muted">
        {{ t('billing.onlineDisabled') }}
      </p>
    </section>

    <!-- 没有任何充值方式：如实说明 -->
    <div
      v-else-if="!infoQ.isLoading.value"
      class="mb-8 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-[12.5px] text-fg-muted"
    >
      {{ t('billing.allDisabled') }}
    </div>

    <!-- 流水 -->
    <h2 class="mb-3 text-[15px] font-semibold tracking-tight">
      {{ t('billing.transactions') }}
    </h2>

    <DataTable
      :columns="columns"
      :rows="recordsQ.data.value?.items ?? []"
      :row-key="(r) => r.id"
      :loading="recordsQ.isLoading.value"
      :error="recordsQ.error.value ? String(recordsQ.error.value.message) : null"
      @retry="recordsQ.refetch()"
    >
      <template #empty>
        <Receipt class="mx-auto size-7 text-fg-subtle" />
        <p class="mt-3 text-[13.5px] font-medium">{{ t('billing.emptyTitle') }}</p>
        <p class="mt-1 text-[12.5px] text-fg-subtle">{{ t('billing.emptyDesc') }}</p>
      </template>

      <template #cell="{ row, column }">
        <template v-if="column.key === 'create_time'">
          {{ formatDateTime(row.create_time) }}
        </template>
        <template v-else-if="column.key === 'trade_no'">
          <span class="font-mono text-[11.5px]">{{ row.trade_no || '—' }}</span>
        </template>
        <template v-else-if="column.key === 'payment_method'">
          {{ row.payment_method || row.payment_provider || '—' }}
        </template>
        <template v-else-if="column.key === 'money'">
          {{ row.money ? formatUsd(row.money) : '—' }}
        </template>
        <template v-else-if="column.key === 'quota'">
          {{ formatQuota(row.quota, quotaPerUnit) }}
        </template>
        <template v-else-if="column.key === 'status'">
          <span
            class="inline-flex rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium"
            :class="STATUS_CLASS[row.status] ?? 'border-border bg-bg-muted text-fg-muted'"
          >
            {{ t(`billing.status_${row.status}`) }}
          </span>
        </template>
      </template>
    </DataTable>

    <Pagination
      v-model:page="page"
      :page-size="PAGE_SIZE"
      :total="recordsQ.data.value?.total ?? 0"
    />

    <!-- 兑换码 -->
    <AppModal
      :open="redeemOpen"
      :title="t('billing.redeemTitle')"
      :description="t('billing.redeemDesc')"
      @close="redeemOpen = false"
    >
      <FormField id="redeem-key" :label="t('billing.redeemLabel')" required>
        <input
          id="redeem-key"
          v-model="redeemKey"
          type="text"
          autocomplete="off"
          spellcheck="false"
          class="h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-[13px] outline-none transition-colors focus:border-accent"
          @keydown.enter="redeemKey.trim() && redeemMut.mutate()"
        />
      </FormField>
      <template #footer>
        <AppButton variant="ghost" @click="redeemOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          variant="primary"
          :disabled="!redeemKey.trim()"
          :loading="redeemMut.isPending.value"
          @click="redeemMut.mutate()"
        >
          {{ t('billing.redeemSubmit') }}
        </AppButton>
      </template>
    </AppModal>

    <!-- USDT 收款 -->
    <AppModal
      :open="usdtOrder !== null"
      :title="t('billing.usdtTitle')"
      :description="t('billing.usdtDesc')"
      :width="440"
      @close="usdtOrder = null"
    >
      <div v-if="usdtOrder" class="space-y-3">
        <div>
          <p class="text-[11.5px] uppercase tracking-wide text-fg-subtle">
            {{ t('billing.usdtAmount') }}
          </p>
          <div class="mt-1 flex items-center gap-2">
            <code class="flex-1 font-mono text-[14px] font-medium">
              {{ usdtOrder.usdt_amount }} USDT
            </code>
            <button
              type="button"
              class="rounded-md border border-border p-1.5 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :aria-label="t('common.copy')"
              @click="copyText(usdtOrder!.usdt_amount)"
            >
              <Copy class="size-3.5" />
            </button>
          </div>
        </div>

        <div>
          <p class="text-[11.5px] uppercase tracking-wide text-fg-subtle">
            {{ t('billing.usdtAddress') }}
          </p>
          <div class="mt-1 flex items-center gap-2">
            <code class="min-w-0 flex-1 break-all font-mono text-[12px]">
              {{ usdtOrder.wallet_address }}
            </code>
            <button
              type="button"
              class="shrink-0 rounded-md border border-border p-1.5 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :aria-label="t('common.copy')"
              @click="copyText(usdtOrder!.wallet_address)"
            >
              <Copy class="size-3.5" />
            </button>
          </div>
        </div>

        <div
          class="rounded-lg border border-warning-border bg-warning-bg p-3 text-[12px] text-warning-fg"
        >
          {{
            t('billing.usdtExpire', {
              m: Math.floor(usdtRemaining / 60),
              s: String(usdtRemaining % 60).padStart(2, '0'),
            })
          }}
        </div>

        <p class="text-[11.5px] text-fg-subtle">{{ t('billing.usdtPolling') }}</p>
      </div>
    </AppModal>
  </div>
</template>
