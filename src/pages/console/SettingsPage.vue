<script setup lang="ts">
/**
 * 账号设置。合并 infron 的 Account Settings 主体 + 后端独有的安全项。
 *
 * 接口的坑（实测 + 源码确认）：
 *   PUT /api/user/self 是「三态」接口 —— 按 key 存在性分派，
 *   顺序 sidebar_modules > language > 资料/密码，命中就 return。
 *   所以改资料、改语言、改密码必须**分开发请求**，混在一个 body 只有一类生效。
 *   改密码必须带 original_password，后端校验。
 *
 * 2FA / OAuth 绑定 / Passkey / 注销账号 都是真实后端能力，
 * 但每块都有站点开关（/api/status），关了就不画对应入口。
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import {
  Copy,
  Check,
  KeyRound,
  LoaderCircle,
  Shield,
  TriangleAlert,
  Unplug,
  User as UserIcon,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import {
  deletePasskey,
  deleteSelf,
  disable2fa,
  enable2fa,
  get2faStatus,
  getOAuthState,
  getPasskey,
  listOAuthBindings,
  regenerateBackupCodes,
  setup2fa,
  unbindOAuth,
  updateProfile,
} from '@/api/account'
import PageHeader from '@/components/ui/PageHeader.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import FormField from '@/components/ui/FormField.vue'

const site = useSiteStore()
const userStore = useUserStore()
const { oauthProviders } = storeToRefs(site)
const { user } = storeToRefs(userStore)
const { t } = useI18n()

const INPUT =
  'h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] outline-none transition-colors focus:border-border-selected'

/**
 * 安全区（2FA / Passkey / 注销账号）暂不对外开放，整块隐藏。
 * 后端能力还在，改成 true 就能原样恢复（相关请求也跟着开关走，关掉时不发）。
 */
const SHOW_SECURITY_SECTIONS = false

// ───────────────── 资料 ─────────────────

const displayName = ref('')
const username = ref('')
const originalPassword = ref('')
const newPassword = ref('')
const newPassword2 = ref('')

watch(
  user,
  (u) => {
    if (u) {
      displayName.value = u.display_name ?? ''
      username.value = u.username ?? ''
    }
  },
  { immediate: true },
)

const passwordMismatch = computed(
  () => newPassword2.value.length > 0 && newPassword.value !== newPassword2.value,
)

/** 资料变更和密码变更拆成两组 payload，分开发 */
const profileDirty = computed(
  () =>
    displayName.value !== (user.value?.display_name ?? '') ||
    username.value !== (user.value?.username ?? ''),
)
const passwordDirty = computed(
  () =>
    newPassword.value.length > 0 &&
    !passwordMismatch.value &&
    originalPassword.value.length > 0,
)

const profileMut = useMutation({
  mutationFn: async () => {
    // 三态接口：先资料，再密码，不能合并
    const jobs: Promise<unknown>[] = []
    if (profileDirty.value) {
      jobs.push(
        updateProfile({
          username: username.value.trim(),
          display_name: displayName.value.trim(),
        }),
      )
    }
    if (passwordDirty.value) {
      jobs.push(
        updateProfile({
          password: newPassword.value,
          original_password: originalPassword.value,
        }),
      )
    }
    if (!jobs.length) throw new Error(t('settings.nothingToSave'))
    await Promise.all(jobs)
  },
  onSuccess: async () => {
    toast.success(t('settings.profileSaved'))
    originalPassword.value = ''
    newPassword.value = ''
    newPassword2.value = ''
    await userStore.fetchSelf()
  },
  onError: (e: Error) => toast.error(e.message),
})

// ───────────────── 2FA ─────────────────

const twoFaQ = useQuery({
  queryKey: ['2fa'],
  queryFn: get2faStatus,
  enabled: SHOW_SECURITY_SECTIONS,
})
const twoFaEnabled = computed(() => twoFaQ.data.value?.enabled === true)

const twoFaSetupOpen = ref(false)
const twoFaSecret = ref('')
const twoFaQr = ref('')
const twoFaCodes = ref<string[]>([])
const twoFaCode = ref('')
const twoFaDisableCode = ref('')
const twoFaDisableOpen = ref(false)

const setupMut = useMutation({
  mutationFn: setup2fa,
  onSuccess: (d) => {
    twoFaSecret.value = d?.secret ?? ''
    twoFaQr.value = d?.qr_code_data ?? ''
    twoFaCodes.value = d?.backup_codes ?? []
    twoFaSetupOpen.value = true
  },
  onError: (e: Error) => toast.error(e.message),
})

const enableMut = useMutation({
  mutationFn: () => enable2fa(twoFaCode.value.trim()),
  onSuccess: async () => {
    toast.success(t('settings.2faEnabled'))
    twoFaSetupOpen.value = false
    twoFaCode.value = ''
    await twoFaQ.refetch()
  },
  onError: (e: Error) => toast.error(e.message),
})

const disableMut = useMutation({
  mutationFn: () => disable2fa(twoFaDisableCode.value.trim()),
  onSuccess: async () => {
    toast.success(t('settings.2faDisabled'))
    twoFaDisableOpen.value = false
    twoFaDisableCode.value = ''
    await twoFaQ.refetch()
  },
  onError: (e: Error) => toast.error(e.message),
})

const backupMut = useMutation({
  mutationFn: (code: string) => regenerateBackupCodes(code),
  onSuccess: (d) => {
    twoFaCodes.value = d?.backup_codes ?? []
    toast.success(t('settings.codesRegenerated'))
  },
  onError: (e: Error) => toast.error(e.message),
})

// ───────────────── OAuth 绑定 ─────────────────

const bindingsQ = useQuery({ queryKey: ['oauth-bindings'], queryFn: listOAuthBindings })
const bindings = computed(() => bindingsQ.data.value ?? [])

const unbindMut = useMutation({
  mutationFn: unbindOAuth,
  onSuccess: async () => {
    toast.success(t('settings.unbound'))
    await bindingsQ.refetch()
  },
  onError: (e: Error) => toast.error(e.message),
})

/** 绑定 = 已登录状态再走一遍 OAuth。state 接口给的 URL 直接跳 */
async function bindProvider() {
  try {
    const url = await getOAuthState()
    if (url) window.location.href = url
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('error.unknown'))
  }
}

// ───────────────── Passkey ─────────────────

const passkeyQ = useQuery({
  queryKey: ['passkey'],
  queryFn: getPasskey,
  enabled: SHOW_SECURITY_SECTIONS,
})
const passkeyEnabled = computed(() => passkeyQ.data.value?.enabled === true)

const passkeyMut = useMutation({
  mutationFn: deletePasskey,
  onSuccess: async () => {
    toast.success(t('settings.passkeyRemoved'))
    await passkeyQ.refetch()
  },
  onError: (e: Error) => toast.error(e.message),
})

// ───────────────── 注销 ─────────────────

const deleteOpen = ref(false)
const deleteMut = useMutation({
  mutationFn: deleteSelf,
  onSuccess: () => {
    toast.success(t('settings.deleted'))
    userStore.clear()
    window.location.href = '/'
  },
  onError: (e: Error) => toast.error(e.message),
})

const copied = ref<string | null>(null)
async function copyText(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = id
    setTimeout(() => (copied.value = null), 1500)
  } catch {
    toast.error(t('keys.copyFailed'))
  }
}
</script>

<template>
  <div>
    <PageHeader :title="t('settings.title')" :description="t('settings.subtitle')" />

    <div class="space-y-6">
      <!-- 资料 -->
      <section class="rounded-xl border border-border bg-bg-elevated p-5">
        <div class="mb-4 flex items-center gap-2">
          <UserIcon class="size-4 text-fg-subtle" />
          <h2 class="text-[15px] font-semibold tracking-tight">
            {{ t('settings.profileTitle') }}
          </h2>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="set-username" :label="t('auth.username')">
            <input id="set-username" v-model="username" type="text" :class="INPUT" />
          </FormField>
          <FormField id="set-displayname" :label="t('settings.displayName')">
            <input id="set-displayname" v-model="displayName" type="text" :class="INPUT" />
          </FormField>
        </div>

        <!-- 密码：三态接口，必须单独发；不填就不改 -->
        <div class="mt-6 border-t border-border pt-5">
          <p class="mb-3 text-[13px] font-medium">{{ t('settings.changePassword') }}</p>
          <div class="grid gap-4 sm:grid-cols-3">
            <FormField id="set-origpwd" :label="t('settings.currentPassword')">
              <input
                id="set-origpwd"
                v-model="originalPassword"
                type="password"
                autocomplete="current-password"
                :class="INPUT"
              />
            </FormField>
            <FormField id="set-newpwd" :label="t('settings.newPassword')">
              <input
                id="set-newpwd"
                v-model="newPassword"
                type="password"
                autocomplete="new-password"
                :class="INPUT"
              />
            </FormField>
            <FormField
              id="set-newpwd2"
              :label="t('settings.confirmNewPassword')"
              :error="passwordMismatch ? t('auth.passwordMismatch') : null"
            >
              <input
                id="set-newpwd2"
                v-model="newPassword2"
                type="password"
                autocomplete="new-password"
                :class="INPUT"
                :aria-invalid="passwordMismatch"
              />
            </FormField>
          </div>
        </div>

        <div class="mt-5">
          <AppButton
            variant="primary"
            :disabled="!profileDirty && !passwordDirty"
            :loading="profileMut.isPending.value"
            @click="profileMut.mutate()"
          >
            {{ t('common.save') }}
          </AppButton>
        </div>
      </section>

      <!-- 2FA -->
      <section
        v-if="SHOW_SECURITY_SECTIONS"
        class="rounded-xl border border-border bg-bg-elevated p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <Shield class="size-4 text-fg-subtle" />
            <div>
              <h2 class="text-[15px] font-semibold tracking-tight">
                {{ t('settings.2faTitle') }}
              </h2>
              <p class="mt-0.5 text-[12.5px] text-fg-muted">
                {{ t('settings.2faDesc') }}
              </p>
            </div>
          </div>
          <span
            class="rounded-full border px-2 py-0.5 text-[11px] font-medium"
            :class="
              twoFaEnabled
                ? 'border-success-border bg-success-bg text-success-fg'
                : 'border-border bg-bg-muted text-fg-muted'
            "
          >
            {{ twoFaEnabled ? t('settings.2faOn') : t('settings.2faOff') }}
          </span>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <AppButton
            v-if="!twoFaEnabled"
            variant="primary"
            :loading="setupMut.isPending.value"
            @click="setupMut.mutate()"
          >
            {{ t('settings.enable2fa') }}
          </AppButton>
          <template v-else>
            <AppButton variant="secondary" @click="twoFaDisableOpen = true">
              {{ t('settings.disable2fa') }}
            </AppButton>
            <AppButton
              variant="secondary"
              :loading="backupMut.isPending.value"
              @click="backupMut.mutate(twoFaDisableCode || '000000')"
            >
              {{ t('settings.regenCodes') }}
            </AppButton>
          </template>
        </div>
      </section>

      <!-- OAuth 绑定 -->
      <section
        v-if="oauthProviders.length"
        class="rounded-xl border border-border bg-bg-elevated p-5"
      >
        <div class="mb-3 flex items-center gap-2">
          <Unplug class="size-4 text-fg-subtle" />
          <h2 class="text-[15px] font-semibold tracking-tight">
            {{ t('settings.oauthTitle') }}
          </h2>
        </div>
        <p class="mb-4 text-[12.5px] text-fg-muted">
          {{ t('settings.oauthDesc') }}
        </p>

        <div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
          <div
            v-for="p in oauthProviders"
            :key="p"
            class="flex items-center gap-3 px-4 py-3"
          >
            <p class="min-w-0 flex-1 text-[13px] font-medium">
              {{ t(`auth.provider.${p}`) }}
            </p>
            <span
              class="text-[11.5px]"
              :class="bindings.some((b) => b.provider_slug === p) ? 'text-success-fg' : 'text-fg-subtle'"
            >
              {{
                bindings.some((b) => b.provider_slug === p)
                  ? t('settings.bound')
                  : t('settings.notBound')
              }}
            </span>
            <AppButton
              v-if="bindings.some((b) => b.provider_slug === p)"
              size="sm"
              variant="ghost"
              :loading="unbindMut.isPending.value"
              @click="unbindMut.mutate(bindings.find((b) => b.provider_slug === p)!.provider_id)"
            >
              {{ t('settings.unbind') }}
            </AppButton>
            <AppButton v-else size="sm" variant="secondary" @click="bindProvider">
              {{ t('settings.bind') }}
            </AppButton>
          </div>
        </div>
      </section>

      <!-- Passkey -->
      <section
        v-if="SHOW_SECURITY_SECTIONS && passkeyQ.data.value"
        class="rounded-xl border border-border bg-bg-elevated p-5"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <KeyRound class="size-4 text-fg-subtle" />
            <div>
              <h2 class="text-[15px] font-semibold tracking-tight">
                {{ t('settings.passkeyTitle') }}
              </h2>
              <p class="mt-0.5 text-[12.5px] text-fg-muted">
                {{ t('settings.passkeyDesc') }}
              </p>
            </div>
          </div>
          <span
            class="rounded-full border px-2 py-0.5 text-[11px] font-medium"
            :class="
              passkeyEnabled
                ? 'border-success-border bg-success-bg text-success-fg'
                : 'border-border bg-bg-muted text-fg-muted'
            "
          >
            {{ passkeyEnabled ? t('settings.passkeyOn') : t('settings.passkeyOff') }}
          </span>
        </div>

        <div v-if="passkeyEnabled" class="mt-4">
          <AppButton
            variant="danger"
            size="sm"
            :loading="passkeyMut.isPending.value"
            @click="passkeyMut.mutate()"
          >
            {{ t('settings.removePasskey') }}
          </AppButton>
        </div>
      </section>

      <!-- 危险区 -->
      <section
        v-if="SHOW_SECURITY_SECTIONS"
        class="rounded-xl border border-danger-border bg-danger-bg/30 p-5"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-2.5">
            <TriangleAlert class="mt-0.5 size-4 shrink-0 text-danger-fg" />
            <div>
              <h2 class="text-[15px] font-semibold tracking-tight text-danger-fg">
                {{ t('settings.dangerTitle') }}
              </h2>
              <p class="mt-0.5 text-[12.5px] leading-relaxed text-fg-muted">
                {{ t('settings.dangerDesc') }}
              </p>
            </div>
          </div>
          <AppButton variant="danger" @click="deleteOpen = true">
            {{ t('settings.deleteAccount') }}
          </AppButton>
        </div>
      </section>
    </div>

    <!-- 2FA 设置 -->
    <AppModal
      :open="twoFaSetupOpen"
      :title="t('settings.2faSetupTitle')"
      :description="t('settings.2faSetupDesc')"
      :width="440"
      @close="twoFaSetupOpen = false"
    >
      <div class="space-y-4">
        <div v-if="twoFaQr" class="flex justify-center">
          <img :src="twoFaQr" alt="2FA QR" class="size-40 rounded-lg border border-border" />
        </div>
        <div>
          <p class="mb-1.5 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            {{ t('settings.2faSecret') }}
          </p>
          <div class="flex items-center gap-2">
            <code
              class="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-subtle px-3 py-2 font-mono text-[12px]"
            >
              {{ twoFaSecret }}
            </code>
            <button
              type="button"
              class="shrink-0 rounded-md border border-border p-1.5 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :aria-label="t('common.copy')"
              @click="copyText(twoFaSecret, 'secret')"
            >
              <Check v-if="copied === 'secret'" class="size-3.5 text-success-fg" />
              <Copy v-else class="size-3.5" />
            </button>
          </div>
        </div>

        <div v-if="twoFaCodes.length">
          <p class="mb-1.5 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            {{ t('settings.2faBackupCodes') }}
          </p>
          <div class="grid grid-cols-2 gap-1.5">
            <code
              v-for="c in twoFaCodes"
              :key="c"
              class="rounded border border-border bg-bg-subtle px-2 py-1 text-center font-mono text-[11px]"
            >
              {{ c }}
            </code>
          </div>
          <p class="mt-1.5 text-[11px] text-fg-subtle">
            {{ t('settings.2faBackupHint') }}
          </p>
        </div>

        <FormField
          id="2fa-code"
          :label="t('settings.2faEnterCode')"
          :hint="t('settings.2faEnterCodeHint')"
          required
        >
          <input
            id="2fa-code"
            v-model="twoFaCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            :class="INPUT"
            class="text-center tabular"
          />
        </FormField>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="twoFaSetupOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          variant="primary"
          :disabled="!twoFaCode.trim()"
          :loading="enableMut.isPending.value"
          @click="enableMut.mutate()"
        >
          {{ t('settings.2faConfirm') }}
        </AppButton>
      </template>
    </AppModal>

    <!-- 2FA 关闭 -->
    <AppModal
      :open="twoFaDisableOpen"
      :title="t('settings.2faDisableTitle')"
      :description="t('settings.2faDisableDesc')"
      @close="twoFaDisableOpen = false"
    >
      <FormField
        id="2fa-disable-code"
        :label="t('settings.2faEnterCode')"
        required
      >
        <input
          id="2fa-disable-code"
          v-model="twoFaDisableCode"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          :class="INPUT"
          class="text-center tabular"
        />
      </FormField>
      <template #footer>
        <AppButton variant="ghost" @click="twoFaDisableOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          variant="danger"
          :disabled="!twoFaDisableCode.trim()"
          :loading="disableMut.isPending.value"
          @click="disableMut.mutate()"
        >
          {{ t('settings.2faDisableConfirm') }}
        </AppButton>
      </template>
    </AppModal>

    <!-- 注销确认 -->
    <AppModal
      :open="deleteOpen"
      :title="t('settings.deleteTitle')"
      :description="t('settings.deleteDesc')"
      @close="deleteOpen = false"
    >
      <div
        class="flex gap-2.5 rounded-lg border border-danger-border bg-danger-bg p-3 text-[12.5px] text-danger-fg"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0" />
        <p>{{ t('settings.deleteWarning') }}</p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="deleteOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          variant="danger"
          :loading="deleteMut.isPending.value"
          @click="deleteMut.mutate()"
        >
          <LoaderCircle v-if="deleteMut.isPending.value" class="size-3.5 animate-spin" />
          {{ t('settings.deleteConfirm') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
