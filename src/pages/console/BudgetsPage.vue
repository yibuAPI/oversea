<script setup lang="ts">
/**
 * 预算与提醒。对齐 infron 的 Budgets & Alerts 页。
 *
 * 后端能力（controller/user.go UpdateUserSetting + service/quota.go）：
 *   quota_warning_threshold 是**剩余额度的绝对阈值**（原始 quota 整数），
 *   不是百分比 —— 剩余低于它就推一次通知。故 UI 上以美元输入并换算。
 *   通知渠道四选一：email / webhook / bark / gotify，
 *   选中哪个，对应字段就变必填（后端会校验，前端先拦一道给即时反馈）。
 *
 * 现值从 /api/user/self 的 setting 字段读（JSON 字符串），
 * 后端没有单独的 GET setting 接口。
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMutation } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import { BellRing, TriangleAlert, Wallet } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { updateUserSetting } from '@/api/account'
import type { UserSettingPayload } from '@/api/types'
import { formatQuota, quotaToUsd } from '@/lib/format'
import PageHeader from '@/components/ui/PageHeader.vue'
import StatCard from '@/components/ui/StatCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import FormField from '@/components/ui/FormField.vue'

const site = useSiteStore()
const userStore = useUserStore()
const { quotaPerUnit } = storeToRefs(site)
const { user } = storeToRefs(userStore)
const { t } = useI18n()

type NotifyType = UserSettingPayload['notify_type']

/** setting 是 JSON 字符串，解析失败按空对象处理（老账号可能没有这个字段） */
const stored = computed<Partial<UserSettingPayload>>(() => {
  const raw = user.value?.setting
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
})

const notifyType = ref<NotifyType>('email')
/** 阈值在表单里是美元，提交时乘 quota_per_unit */
const thresholdUsd = ref('')
const notificationEmail = ref('')
const webhookUrl = ref('')
const webhookSecret = ref('')
const barkUrl = ref('')
const gotifyUrl = ref('')
const gotifyToken = ref('')
const gotifyPriority = ref(5)
const acceptUnsetRatio = ref(false)
const recordIpLog = ref(false)

/** 后端默认阈值（common.QuotaRemindThreshold），阈值为 0 时生效 */
const DEFAULT_THRESHOLD_QUOTA = 1000

/** 把已存的设置灌进表单。user 可能晚于组件挂载才到，故用 watch + immediate */
watch(
  stored,
  (s) => {
    notifyType.value = (s.notify_type as NotifyType) || 'email'
    const th = Number(s.quota_warning_threshold ?? 0)
    thresholdUsd.value =
      th > 0 ? String(quotaToUsd(th, quotaPerUnit.value)) : ''
    notificationEmail.value = s.notification_email ?? ''
    webhookUrl.value = s.webhook_url ?? ''
    webhookSecret.value = s.webhook_secret ?? ''
    barkUrl.value = s.bark_url ?? ''
    gotifyUrl.value = s.gotify_url ?? ''
    gotifyToken.value = s.gotify_token ?? ''
    gotifyPriority.value = s.gotify_priority ?? 5
    acceptUnsetRatio.value = s.accept_unset_model_ratio_model ?? false
    recordIpLog.value = s.record_ip_log ?? false
  },
  { immediate: true },
)

const CHANNELS: { key: NotifyType; icon: string }[] = [
  { key: 'email', icon: '✉' },
  { key: 'webhook', icon: '⇢' },
  { key: 'bark', icon: '🔔' },
  { key: 'gotify', icon: '◆' },
]

// ───────────────── 校验 ─────────────────

/** 与后端校验规则一一对应，提前给反馈，避免提交后才报错 */
const errors = computed(() => {
  const e: Record<string, string> = {}

  const usd = Number(thresholdUsd.value)
  // type="number" 的 v-model 会把值强转成 number，不能假设它是字符串
  if (!thresholdUsd.value) e.threshold = t('budgets.errThresholdEmpty')
  else if (!Number.isFinite(usd) || usd <= 0) e.threshold = t('budgets.errThresholdGtZero')

  if (notifyType.value === 'webhook') {
    if (!webhookUrl.value.trim()) e.webhook = t('budgets.errWebhookEmpty')
    else if (!/^https?:\/\//.test(webhookUrl.value.trim()))
      e.webhook = t('budgets.errUrlHttp')
  }
  if (notifyType.value === 'email' && notificationEmail.value.trim()) {
    if (!notificationEmail.value.includes('@')) e.email = t('budgets.errEmail')
  }
  if (notifyType.value === 'bark') {
    if (!barkUrl.value.trim()) e.bark = t('budgets.errBarkEmpty')
    else if (!/^https?:\/\//.test(barkUrl.value.trim())) e.bark = t('budgets.errUrlHttp')
  }
  if (notifyType.value === 'gotify') {
    if (!gotifyUrl.value.trim()) e.gotify = t('budgets.errGotifyUrlEmpty')
    else if (!/^https?:\/\//.test(gotifyUrl.value.trim()))
      e.gotify = t('budgets.errUrlHttp')
    if (!gotifyToken.value.trim()) e.gotifyToken = t('budgets.errGotifyTokenEmpty')
  }
  return e
})

const valid = computed(() => Object.keys(errors.value).length === 0)

const thresholdQuota = computed(() => {
  const usd = Number(thresholdUsd.value)
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * quotaPerUnit.value) : 0
})

/** 当前是否已经低于阈值 —— 已触发时要在页面上说明，别让用户以为没生效 */
const alreadyBelow = computed(() => {
  const th = thresholdQuota.value || DEFAULT_THRESHOLD_QUOTA
  return (user.value?.quota ?? 0) < th
})

/** 按当前用量估算还能撑多久。没有历史用量就不猜 */
const runwayHint = computed(() => {
  const q = user.value?.quota ?? 0
  const used = user.value?.used_quota ?? 0
  if (used <= 0 || q <= 0) return null
  return { balance: q, used }
})

const saveMut = useMutation({
  mutationFn: () => {
    const payload: UserSettingPayload = {
      notify_type: notifyType.value,
      quota_warning_threshold: thresholdQuota.value,
      accept_unset_model_ratio_model: acceptUnsetRatio.value,
      record_ip_log: recordIpLog.value,
    }
    // 只带当前渠道需要的字段，避免把无关配置写脏
    if (notifyType.value === 'email' && notificationEmail.value.trim())
      payload.notification_email = notificationEmail.value.trim()
    if (notifyType.value === 'webhook') {
      payload.webhook_url = webhookUrl.value.trim()
      if (webhookSecret.value.trim()) payload.webhook_secret = webhookSecret.value.trim()
    }
    if (notifyType.value === 'bark') payload.bark_url = barkUrl.value.trim()
    if (notifyType.value === 'gotify') {
      payload.gotify_url = gotifyUrl.value.trim()
      payload.gotify_token = gotifyToken.value.trim()
      payload.gotify_priority = gotifyPriority.value
    }
    return updateUserSetting(payload)
  },
  onSuccess: async () => {
    toast.success(t('budgets.saved'))
    // 现值来自 user.setting，必须重拉才能反映刚保存的内容
    await userStore.fetchSelf()
  },
  onError: (e: Error) => toast.error(e.message),
})

const INPUT =
  'h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected'
</script>

<template>
  <div>
    <PageHeader :title="t('budgets.title')" :description="t('budgets.subtitle')" />

    <div class="mb-6 grid gap-3 sm:grid-cols-3">
      <StatCard
        :label="t('budgets.currentBalance')"
        :value="formatQuota(user?.quota ?? 0, quotaPerUnit)"
        :icon="Wallet"
      />
      <StatCard
        :label="t('budgets.activeThreshold')"
        :value="
          thresholdQuota > 0
            ? formatQuota(thresholdQuota, quotaPerUnit)
            : formatQuota(DEFAULT_THRESHOLD_QUOTA, quotaPerUnit)
        "
        :hint="thresholdQuota > 0 ? undefined : t('budgets.usingDefault')"
        :icon="TriangleAlert"
      />
      <StatCard
        :label="t('budgets.channel')"
        :value="t(`budgets.ch_${notifyType}`)"
        :icon="BellRing"
      />
    </div>

    <!-- 已低于阈值：如实提示 -->
    <div
      v-if="alreadyBelow"
      class="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-[12.5px] text-warning-fg"
    >
      <TriangleAlert class="size-4 shrink-0" />
      <span class="flex-1">{{ t('budgets.belowThreshold') }}</span>
      <RouterLink
        to="/console/billing"
        class="shrink-0 font-medium underline underline-offset-2"
      >
        {{ t('console.topUp') }}
      </RouterLink>
    </div>

    <form class="space-y-6" @submit.prevent="valid && saveMut.mutate()">
      <!-- 阈值 -->
      <section class="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 class="text-[15px] font-semibold tracking-tight">
          {{ t('budgets.thresholdTitle') }}
        </h2>
        <p class="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
          {{ t('budgets.thresholdDesc') }}
        </p>

        <div class="mt-4 max-w-[280px]">
          <FormField
            id="threshold"
            :label="t('budgets.thresholdLabel')"
            :error="errors.threshold"
            :hint="t('budgets.thresholdHint')"
            required
          >
            <div class="relative">
              <span
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-subtle"
              >
                $
              </span>
              <input
                id="threshold"
                v-model="thresholdUsd"
                type="number"
                min="0"
                step="0.01"
                :class="INPUT"
                class="pl-7 tabular"
              />
            </div>
          </FormField>
        </div>

        <p v-if="runwayHint" class="mt-3 text-[12px] text-fg-subtle">
          {{
            t('budgets.runway', {
              balance: formatQuota(runwayHint.balance, quotaPerUnit),
              used: formatQuota(runwayHint.used, quotaPerUnit),
            })
          }}
        </p>
      </section>

      <!-- 渠道 -->
      <section class="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 class="text-[15px] font-semibold tracking-tight">
          {{ t('budgets.channelTitle') }}
        </h2>
        <p class="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
          {{ t('budgets.channelDesc') }}
        </p>

        <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            v-for="c in CHANNELS"
            :key="c.key"
            type="button"
            class="rounded-xl border p-3 text-left transition-colors"
            :class="
              notifyType === c.key
                ? 'border-border-selected bg-accent-bg'
                : 'border-border hover:bg-bg-subtle'
            "
            :aria-pressed="notifyType === c.key"
            @click="notifyType = c.key"
          >
            <p
              class="text-[13px] font-medium"
              :class="notifyType === c.key ? 'text-accent' : ''"
            >
              {{ t(`budgets.ch_${c.key}`) }}
            </p>
            <p class="mt-0.5 text-[11.5px] text-fg-subtle">
              {{ t(`budgets.chDesc_${c.key}`) }}
            </p>
          </button>
        </div>

        <!-- 渠道字段：只显示当前选中渠道需要的 -->
        <div class="mt-5 max-w-[440px] space-y-4">
          <FormField
            v-if="notifyType === 'email'"
            id="notify-email"
            :label="t('budgets.emailLabel')"
            :hint="t('budgets.emailHint', { email: user?.email || '—' })"
            :error="errors.email"
          >
            <input
              id="notify-email"
              v-model="notificationEmail"
              type="email"
              :placeholder="user?.email || 'you@example.com'"
              :class="INPUT"
            />
          </FormField>

          <template v-if="notifyType === 'webhook'">
            <FormField
              id="webhook-url"
              :label="t('budgets.webhookLabel')"
              :error="errors.webhook"
              required
            >
              <input
                id="webhook-url"
                v-model="webhookUrl"
                type="url"
                placeholder="https://example.com/hook"
                :class="INPUT"
              />
            </FormField>
            <FormField
              id="webhook-secret"
              :label="t('budgets.webhookSecretLabel')"
              :hint="t('budgets.webhookSecretHint')"
            >
              <input
                id="webhook-secret"
                v-model="webhookSecret"
                type="password"
                autocomplete="off"
                :class="INPUT"
              />
            </FormField>
          </template>

          <FormField
            v-if="notifyType === 'bark'"
            id="bark-url"
            :label="t('budgets.barkLabel')"
            :hint="t('budgets.barkHint')"
            :error="errors.bark"
            required
          >
            <input
              id="bark-url"
              v-model="barkUrl"
              type="url"
              placeholder="https://api.day.app/YOUR_KEY"
              :class="INPUT"
            />
          </FormField>

          <template v-if="notifyType === 'gotify'">
            <FormField
              id="gotify-url"
              :label="t('budgets.gotifyUrlLabel')"
              :error="errors.gotify"
              required
            >
              <input
                id="gotify-url"
                v-model="gotifyUrl"
                type="url"
                placeholder="https://gotify.example.com"
                :class="INPUT"
              />
            </FormField>
            <FormField
              id="gotify-token"
              :label="t('budgets.gotifyTokenLabel')"
              :error="errors.gotifyToken"
              required
            >
              <input
                id="gotify-token"
                v-model="gotifyToken"
                type="text"
                autocomplete="off"
                :class="INPUT"
              />
            </FormField>
            <FormField
              id="gotify-priority"
              :label="t('budgets.gotifyPriorityLabel')"
              :hint="t('budgets.gotifyPriorityHint')"
            >
              <input
                id="gotify-priority"
                v-model.number="gotifyPriority"
                type="number"
                min="0"
                max="10"
                :class="INPUT"
                class="tabular"
              />
            </FormField>
          </template>
        </div>
      </section>

      <!-- 其他偏好 -->
      <section class="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 class="text-[15px] font-semibold tracking-tight">
          {{ t('budgets.prefsTitle') }}
        </h2>

        <div class="mt-4 space-y-3.5">
          <label class="flex items-start gap-2.5">
            <input
              v-model="acceptUnsetRatio"
              type="checkbox"
              class="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--color-accent)]"
            />
            <span>
              <span class="block text-[13px] font-medium">
                {{ t('budgets.acceptUnsetLabel') }}
              </span>
              <span class="mt-0.5 block text-[11.5px] leading-relaxed text-fg-subtle">
                {{ t('budgets.acceptUnsetHint') }}
              </span>
            </span>
          </label>

          <label class="flex items-start gap-2.5">
            <input
              v-model="recordIpLog"
              type="checkbox"
              class="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--color-accent)]"
            />
            <span>
              <span class="block text-[13px] font-medium">
                {{ t('budgets.recordIpLabel') }}
              </span>
              <span class="mt-0.5 block text-[11.5px] leading-relaxed text-fg-subtle">
                {{ t('budgets.recordIpHint') }}
              </span>
            </span>
          </label>
        </div>
      </section>

      <div class="flex items-center gap-3">
        <AppButton
          type="submit"
          variant="primary"
          :disabled="!valid"
          :loading="saveMut.isPending.value"
        >
          {{ t('common.save') }}
        </AppButton>
        <p v-if="!valid" class="text-[12px] text-fg-subtle">
          {{ t('budgets.fixErrors') }}
        </p>
      </div>
    </form>
  </div>
</template>
