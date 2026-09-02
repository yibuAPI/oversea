<script setup lang="ts">
/**
 * 账单与充值。版式对齐设计稿「账户与充值」：
 *   三张渐变指标卡 -> 充值卡（快捷金额 / 金额输入 / 支付按钮 / 支付方式）
 *   -> 兑换码 -> 充值说明；交易流水收进右上角「交易记录」弹窗。
 *
 * 支付通道全部由 /api/user/topup/info 的开关决定，一个没开就只剩兑换码：
 *   enable_stripe_topup  Stripe：返回 pay_link，直接跳
 *   enable_usdt_topup    USDT：返回钱包地址，需轮询到账
 *   enable_redemption    兑换码：走标准 envelope
 *
 * 支付方式一行照设计稿摆六格，但只在对应开关打开时才渲染 —— 绝不画点了会报错的按钮。
 * 其中前五格（银行卡 / Apple Pay / Link / 微信 / 支付宝）都属于 Stripe，
 * 点哪一个都跳同一个 Stripe 收银台；第六格加密货币走 USDT。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { Component } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { ArrowUpRight, Copy, Receipt, Wallet } from 'lucide-vue-next'
import IconAlipay from '@/components/icons/IconAlipay.vue'
import IconApplePay from '@/components/icons/IconApplePay.vue'
import IconBitcoin from '@/components/icons/IconBitcoin.vue'
import IconCard from '@/components/icons/IconCard.vue'
import IconLink from '@/components/icons/IconLink.vue'
import IconWechatPay from '@/components/icons/IconWechatPay.vue'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import {
  calcAmount,
  calcStripeAmount,
  getTopUpInfo,
  getUsdtStatus,
  listTopUps,
  payStripe,
  payUsdt,
  redeemCode,
} from '@/api/billing'
import { formatDateTime, formatQuota, formatUsd } from '@/lib/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatCard from '@/components/ui/StatCard.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'

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

/** 任一在线通道开着 */
const anyOnline = computed(
  () => info.value?.enable_stripe_topup || info.value?.enable_usdt_topup,
)

/** 快捷金额。后端可配 amount_options，没配就用一组常见档位 */
const amountOptions = computed(() =>
  info.value?.amount_options?.length ? info.value.amount_options : [10, 20, 50, 100, 200],
)

const minTopup = computed(() => info.value?.min_topup ?? 1)

// ---------------- 支付通道 ----------------

type PayChannel = 'stripe' | 'usdt'

interface PayOption {
  key: string
  channel: PayChannel
  label: string
  icon: Component
  /** 品牌色，留空表示跟随选中态（currentColor）或图标自带配色 */
  tint: string
  /** 该通道自己的最低充值额，可能高于站点通用值 */
  min: number
}

/**
 * Stripe 收银台内部支持的几种方式。
 *
 * 后端 payStripe 只收金额，没有 payment_method 参数，所以这几格点下去
 * 跳的是同一个 Stripe 收银台，具体用哪种在收银台里选 ——
 * 摆出来是为了让人一眼看到支持什么，点任一格即弹出支付确认。
 */
const STRIPE_METHODS: [string, string, Component, string][] = [
  ['card', 'billing.mCard', IconCard, ''],
  ['applepay', 'billing.mApplePay', IconApplePay, ''],
  ['link', 'billing.mLink', IconLink, ''],
  ['wechat', 'billing.mWechat', IconWechatPay, '#07C160'],
  ['alipay', 'billing.mAlipay', IconAlipay, '#1677FF'],
]

const payOptions = computed<PayOption[]>(() => {
  const i = info.value
  if (!i) return []
  const list: PayOption[] = []

  if (i.enable_stripe_topup) {
    const min = i.stripe_min_topup ?? minTopup.value
    for (const [k, label, icon, tint] of STRIPE_METHODS) {
      list.push({ key: `stripe:${k}`, channel: 'stripe', label: t(label), icon, tint, min })
    }
  }

  if (i.enable_usdt_topup) {
    list.push({
      key: 'usdt',
      channel: 'usdt',
      label: t('billing.mCrypto'),
      icon: IconBitcoin,
      tint: '',
      min: i.usdt_min_topup ?? minTopup.value,
    })
  }

  return list
})

const methodKey = ref('')
watch(
  payOptions,
  (list) => {
    // 选中的通道被后端关掉时要落回第一个，否则会停在一个不存在的选项上
    if (!list.some((o) => o.key === methodKey.value)) methodKey.value = list[0]?.key ?? ''
  },
  { immediate: true },
)
const method = computed(() => payOptions.value.find((o) => o.key === methodKey.value) ?? null)

/** 当前通道的最低充值额 */
const effMin = computed(() => method.value?.min ?? minTopup.value)

// ---------------- 金额与试算 ----------------

const amount = ref<number>(0)
watch(
  amountOptions,
  (opts) => {
    // 默认充值金额：优先取 $10 档位，没有就取第一个档位
    if (!amount.value && opts.length) {
      amount.value = opts.includes(10) ? 10 : opts[0]
    }
  },
  { immediate: true },
)

/**
 * 折扣表是 { 金额: 倍率 } 且后端**精确匹配**（充 99 不会套用 100 的折扣），
 * 所以只在快捷档位上标折扣；自定义金额一律以后端试算为准。
 */
function ratioOf(a: number): number {
  const r = Number(info.value?.discount?.[String(a)])
  return Number.isFinite(r) && r > 0 && r < 1 ? r : 1
}

const amountCards = computed(() =>
  amountOptions.value.map((a) => {
    const ratio = ratioOf(a)
    return {
      amount: a,
      price: formatUsd(a * ratio),
      tag:
        ratio < 1
          ? t('billing.discountTag', {
              tenth: Number((ratio * 10).toFixed(2)),
              off: Math.round((1 - ratio) * 100),
            })
          : '',
    }
  }),
)

const belowMin = computed(() => amount.value > 0 && amount.value < effMin.value)

/** 后端试算实付价。Stripe 有独立算价接口，选中它时要走那条 */
const quoteQ = useQuery({
  queryKey: computed(() => ['topup-quote', amount.value, method.value?.channel ?? '']),
  queryFn: () =>
    method.value?.channel === 'stripe' ? calcStripeAmount(amount.value) : calcAmount(amount.value),
  enabled: computed(() => payOptions.value.length > 0 && amount.value >= effMin.value),
})

/** 试算未回来时先用本地折扣估一个，别让按钮上的金额空着 */
const payPrice = computed(() => {
  const q = quoteQ.data.value
  if (q && !belowMin.value) return `$${q}`
  return formatUsd((amount.value || 0) * ratioOf(amount.value))
})

// ---------------- Stripe ----------------

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

// ---------------- USDT ----------------

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

// ---------------- 支付确认 ----------------

const paying = computed(() => stripeMut.isPending.value || usdtMut.isPending.value)
const canPay = computed(() => Boolean(method.value) && amount.value >= effMin.value)

const confirmOpen = ref(false)

/** 点击支付方式图标：Stripe 弹支付确认；加密货币走 USDT 异步到账，直接支付 */
function selectPay(key: string) {
  methodKey.value = key
  const m = method.value
  // 加密货币无需二次确认，金额合法就直接发起；金额不足时由 belowMin 提示兜底
  if (m?.channel === 'usdt') {
    if (canPay.value) usdtMut.mutate()
    return
  }
  confirmOpen.value = true
}

function runPay() {
  confirmOpen.value = false
  const m = method.value
  if (!m) return
  if (m.channel === 'stripe') stripeMut.mutate()
  else usdtMut.mutate()
}

// ---------------- 兑换码 ----------------

const redeemKey = ref('')
const redeemMut = useMutation({
  mutationFn: () => redeemCode(redeemKey.value.trim()),
  onSuccess: async (added) => {
    toast.success(t('billing.redeemSuccess', { v: formatQuota(added ?? 0, quotaPerUnit.value) }))
    redeemKey.value = ''
    // 余额和流水都变了
    await Promise.all([userStore.fetchSelf(), qc.invalidateQueries({ queryKey: ['topups'] })])
  },
  onError: (e: Error) => toast.error(e.message),
})

// ---------------- 流水 ----------------

const txOpen = ref(false)

const columns = computed<Column[]>(() => [
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

/** 充值说明：站点固定文案 */
const notes = computed(() => [
  t('billing.note2'),
  t('billing.note3'),
  t('billing.note4'),
])
</script>

<template>
  <div>
    <PageHeader :title="t('billing.title')" :description="t('billing.subtitle')">
      <template #actions>
        <AppButton size="md" @click="txOpen = true">
          <Receipt class="size-3.5" />
          {{ t('billing.transactions') }}
        </AppButton>
      </template>
    </PageHeader>

    <div class="mb-5 grid gap-3 sm:grid-cols-3">
      <StatCard
        :label="t('billing.balance')"
        :value="formatQuota(user?.quota ?? 0, quotaPerUnit)"
        :icon="Wallet"
        tone="blue"
      />
      <StatCard
        :label="t('billing.lifetimeUsed')"
        :value="formatQuota(user?.used_quota ?? 0, quotaPerUnit)"
        :icon="Receipt"
        tone="violet"
      />
      <StatCard
        :label="t('billing.recentTopUp')"
        :value="formatQuota(totalTopUp, quotaPerUnit)"
        :hint="t('billing.recentHint')"
        :icon="ArrowUpRight"
        :loading="recordsQ.isLoading.value"
        tone="mint"
      />
    </div>

    <!-- 充值卡：有可用在线通道时才画 -->
    <section
      v-if="payOptions.length"
      class="mb-2 rounded-2xl border border-border bg-bg-elevated p-3.5"
    >
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        <button
          v-for="c in amountCards"
          :key="c.amount"
          type="button"
          class="motion-press relative min-h-[68px] overflow-hidden rounded-xl border px-2 py-2 text-center transition-colors"
          :class="
            amount === c.amount
              ? 'border-border-selected bg-accent-bg'
              : 'border-border bg-bg-subtle hover:border-border-strong'
          "
          @click="amount = c.amount"
        >
          <span
            v-if="c.tag"
            class="absolute right-0 top-0 inline-flex h-4 items-center justify-center rounded-bl-lg rounded-tr-xl bg-success-fg px-1.5 text-[9px] font-bold text-white"
          >
            {{ c.tag }}
          </span>
          <span class="block text-[20px] font-bold leading-none tabular">$ {{ c.amount }}</span>
          <span class="mt-1.5 block text-[11px] leading-tight text-fg-muted">
            {{ t('billing.actualPay', { v: c.price }) }}
          </span>
        </button>
      </div>

      <label for="topup-amount" class="mb-2 mt-4 block text-[15px] font-bold">
        {{ t('billing.amountLabel') }}
      </label>
      <div class="relative">
        <span
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] font-semibold text-fg-subtle"
        >
          $
        </span>
        <input
          id="topup-amount"
          v-model.number="amount"
          type="number"
          :min="effMin"
          step="1"
          :aria-label="t('billing.customAmount')"
          class="h-[42px] w-full rounded-[10px] border border-border bg-bg-inset pl-8 pr-3 text-[22px] font-semibold tabular outline-none transition-colors focus:border-border-selected"
        />
      </div>

      <p v-if="belowMin" class="mt-2 text-[12px] text-danger-fg">
        {{ t('billing.belowMin', { v: `$${effMin}` }) }}
      </p>

      <!-- 支付方式：按后端真实开关渲染；点图标直接发起支付 -->
      <p class="mt-5 text-left text-[15px] font-bold text-fg-muted">
        {{ t('billing.selectMethod') }}
      </p>
      <div class="mt-3.5 flex flex-wrap gap-2.5 sm:flex-nowrap">
        <button
          v-for="m in payOptions"
          :key="m.key"
          type="button"
          class="motion-press group w-[84px] transition-transform duration-150 hover:scale-105 sm:w-auto sm:flex-1 sm:basis-0"
          @click="selectPay(m.key)"
        >
          <span
            class="flex h-[42px] items-center justify-center rounded-xl border border-border bg-bg-subtle text-fg-muted transition-colors group-hover:border-border-strong group-hover:text-fg"
          >
            <component
              :is="m.icon"
              class="h-5 w-auto max-w-[46px] shrink-0"
              :style="m.tint ? { color: m.tint } : undefined"
              aria-hidden="true"
            />
          </span>
          <span class="mt-1.5 block truncate text-center text-[11px] text-fg-muted">
            {{ m.label }}
          </span>
        </button>
      </div>
    </section>

    <!-- 在线通道全关：如实说明，别留空白 -->
    <div
      v-if="!anyOnline && info?.enable_redemption"
      class="mb-2 rounded-2xl border border-border bg-bg-subtle px-4 py-3 text-[12.5px] text-fg-muted"
    >
      {{ t('billing.onlineDisabled') }}
    </div>
    <div
      v-else-if="!anyOnline && !info?.enable_redemption && !infoQ.isLoading.value"
      class="mb-2 rounded-2xl border border-border bg-bg-subtle px-4 py-3 text-[12.5px] text-fg-muted"
    >
      {{ t('billing.allDisabled') }}
    </div>

    <!-- 兑换码 -->
    <section
      v-if="info?.enable_redemption"
      class="mb-2 rounded-2xl border border-border bg-bg-elevated"
    >
      <h2 class="border-b border-border px-4 py-3 text-[14px] font-bold">
        {{ t('billing.redeemTitle') }}
      </h2>
      <div class="flex items-center gap-3 p-4">
        <input
          v-model="redeemKey"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('billing.redeemTitle')"
          :placeholder="t('billing.redeemPlaceholder')"
          class="h-9 min-w-0 flex-1 rounded-xl border border-border bg-bg-inset px-3.5 font-mono text-[13px] outline-none transition-colors focus:border-border-selected"
          @keydown.enter="redeemKey.trim() && redeemMut.mutate()"
        />
        <AppButton
          variant="primary"
          :disabled="!redeemKey.trim()"
          :loading="redeemMut.isPending.value"
          @click="redeemMut.mutate()"
        >
          {{ t('billing.redeemSubmit') }}
        </AppButton>
      </div>
    </section>

    <!-- 充值说明 -->
    <section class="rounded-2xl border border-border bg-bg-elevated">
      <h2 class="border-b border-border px-4 py-3 text-[14px] font-bold">
        {{ t('billing.notesTitle') }}
      </h2>
      <ul class="space-y-2 px-4 py-3.5 text-[13px] leading-relaxed text-fg-muted">
        <li v-for="(n, i) in notes" :key="i" class="flex gap-2.5">
          <span
            class="mt-[7px] size-1.5 shrink-0 rounded-full"
            :class="i === 0 ? 'bg-warning-fg' : 'bg-fg-subtle'"
            aria-hidden="true"
          />
          <span>{{ n }}</span>
        </li>
      </ul>
    </section>

    <!-- 充值确认 -->
    <AppModal
      :open="confirmOpen"
      :title="t('billing.confirmTitle')"
      :width="430"
      @close="confirmOpen = false"
    >
      <div class="space-y-2.5 text-[13.5px]">
        <div class="flex items-center justify-between">
          <span class="text-fg-muted">{{ t('billing.confirmQuantity') }}</span>
          <span class="tabular">{{ formatUsd(amount || 0) }}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-fg-muted">{{ t('billing.confirmAmount') }}</span>
          <strong class="text-[15px] tabular">{{ payPrice }}</strong>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-fg-muted">{{ t('billing.confirmMethod') }}</span>
          <span>{{ method?.label ?? '—' }}</span>
        </div>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton variant="primary" :loading="paying" :disabled="!canPay" @click="runPay()">
          {{ t('common.confirm') }}
        </AppButton>
      </template>
    </AppModal>

    <!-- 交易记录 -->
    <AppModal
      :open="txOpen"
      :title="t('billing.transactions')"
      :width="1080"
      @close="txOpen = false"
    >
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
