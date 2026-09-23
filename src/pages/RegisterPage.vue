<script setup lang="ts">
/**
 * 注册页 —— 版式与登录页严格一致（同一个壳、同一列宽 384、同样的控件尺寸），
 * infron 的两页也是同一套壳，只换标题和字段。
 *
 * 主题：与登录页一样消费全站 token（原先两页都写死黑底，浅色主题下会掉进
 * 黑屏）。色值一律走 token 类，别再写 #xxxxxx。
 *
 * 后端约束（router/api-router.go + controller/user.go）：
 *   - 注册总开关 register_enabled，关了直接不给表单
 *   - email_verification 开启时 email + verification_code 必填，
 *     验证码要先调 GET /api/verification 发送
 *   - turnstile_check 开启时需带 turnstile token（此处未接人机验证组件，
 *     开启状态下给出明确提示而不是让用户白填一遍）
 *   - 注册成功后端**不自动登录**（只返回 success），故成功后跳登录页
 *   - aff_code 从 URL ?aff= 带入，用于邀请返利
 */
import { computed, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { LoaderCircle, Languages, Sun, Moon } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useThemeStore } from '@/stores/theme'
import { register } from '@/api/auth'
import { sendEmailCode } from '@/api/account'
import { ApiError } from '@/api/types'
import ProviderIcon from '@/components/auth/ProviderIcon.vue'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import { setLocale } from '@/i18n'
import { clearAffCode, readAffCode } from '@/utils/aff-code'
import { USERNAME_MAX, isValidUsername, sanitizeUsername } from '@/utils/username'
import { PASSWORD_MAX, isValidPassword } from '@/utils/password'

const site = useSiteStore()
const theme = useThemeStore()
const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()

function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}
const {
  systemName,
  logo,
  registerEnabled,
  emailVerification,
  turnstileEnabled,
  oauthProviders,
} = storeToRefs(site)

const username = ref('')
const password = ref('')
const password2 = ref('')
const email = ref('')
const code = ref('')
const submitting = ref(false)

/** 邀请码：注册链接形如 /register?aff=xxxx。
 *  URL 上没有时回落到持久层 —— 用户可能先点了「去登录」再折返，
 *  或走了 OAuth 跳转，这两条路径都会把 query 冲掉。 */
const affCode = computed(
  () => (typeof route.query.aff === 'string' ? route.query.aff : '') || readAffCode() || undefined,
)

// ───────────────── 用户名 ─────────────────
/** 用户名只收字母/数字/下划线，30 位以内（见 utils/username）。
 *  输入、粘贴、输入法上屏都过一遍净化，非法字符当场进不来 ——
 *  后端虽然也会拒，但那要等表单提交完才知道，白填一遍密码。
 *  净化后回写 el.value：maxlength 拦不住输入法组字与整段粘贴，这里补一道。 */
function onUsernameInput(e: Event) {
  const el = e.target as HTMLInputElement
  const clean = sanitizeUsername(el.value)
  if (clean !== el.value) el.value = clean
  username.value = clean
}

/** 净化后长度必然合规，这里只剩「非空」和「至少一个合法字符」两件事，
 *  所以不必再报一次错累加 onSubmit 的异常分支 */
const usernameOk = computed(() => isValidUsername(username.value))

/** 只在浏览器自动填充等绕过 @input 的路径下才可能为 true，留作兜底 */
const usernameInvalid = computed(
  () => username.value.length > 0 && !isValidUsername(username.value),
)

// ───────────────── 邮箱验证码 ─────────────────
const sending = ref(false)
/** 冷却秒数。后端对 /api/verification 有频率限制，前端先拦一道 */
const cooldown = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

onUnmounted(() => clearInterval(timer))

async function onSendCode() {
  if (sending.value || cooldown.value > 0) return
  if (!email.value.trim()) {
    toast.error(t('auth.emailRequired'))
    return
  }
  sending.value = true
  try {
    await sendEmailCode(email.value.trim())
    toast.success(t('auth.codeSent'))
    cooldown.value = 60
    timer = setInterval(() => {
      cooldown.value -= 1
      if (cooldown.value <= 0) clearInterval(timer)
    }, 1000)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('error.unknown'))
  } finally {
    sending.value = false
  }
}

// ───────────────── 提交 ─────────────────

/** 两次密码一致性是纯前端校验，后端不管，必须自己拦 */
const mismatch = computed(
  () => password2.value.length > 0 && password.value !== password2.value,
)

/** 密码 8–20 位（见 utils/password）。与用户名不同，密码不做输入净化 ——
 *  截断密码等于悄悄改掉用户的密码，只能提示、不能代改。
 *  空值时不报错，避免一进页面就满屏红字。 */
const passwordInvalid = computed(
  () => password.value.length > 0 && !isValidPassword(password.value),
)

const canSubmit = computed(
  () =>
    !submitting.value &&
    usernameOk.value &&
    isValidPassword(password.value) &&
    !mismatch.value &&
    (!emailVerification.value || (email.value.trim() && code.value.trim())),
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    await register({
      username: username.value.trim(),
      password: password.value,
      ...(emailVerification.value
        ? { email: email.value.trim(), verification_code: code.value.trim() }
        : {}),
      ...(affCode.value ? { aff_code: affCode.value } : {}),
    })
    // 后端注册后不建立 session，所以这里只能引导去登录
    clearAffCode()
    toast.success(t('auth.registerSuccess'))
    await router.replace({ name: 'login' })
  } catch (e) {
    const msg =
      e instanceof ApiError
        ? e.isRateLimited
          ? t('error.rateLimited', { n: e.retryAfter ?? 60 })
          : e.message
        : t('error.unknown')
    toast.error(msg)
  } finally {
    submitting.value = false
  }
}

function oauthUrl(p: string) {
  const aff = affCode.value ? `&aff=${encodeURIComponent(affCode.value)}` : ''
  return `/api/oauth/${p}?redirect=${encodeURIComponent('/console')}${aff}`
}

const INPUT_CLASS =
  'h-10 w-full rounded-[6px] border border-border bg-transparent px-3 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-border-selected'
</script>

<template>
  <div class="relative min-h-dvh bg-bg text-fg antialiased">
    <RouterLink
      to="/"
      class="absolute left-6 top-6 z-10 flex items-center gap-2 transition-opacity hover:opacity-70 sm:left-10"
    >
      <img :src="logo" :alt="systemName" class="h-6 w-auto" />
      <span class="text-[17px] font-semibold tracking-tight">{{ systemName }}</span>
    </RouterLink>

    <!-- 右上角：主题 + 语言。与登录页同一套，两页都没有站点顶栏 -->
    <div class="absolute right-6 top-6 z-10 flex items-center gap-1 sm:right-10">
      <button
        type="button"
        class="motion-press rounded-full p-2 text-fg-muted hover:bg-bg-muted hover:text-fg"
        :aria-label="t('theme.toggle')"
        @click="theme.toggle()"
      >
        <Sun v-if="theme.isDark" class="size-5" />
        <Moon v-else class="size-5" />
      </button>
      <button
        type="button"
        class="motion-press rounded-full p-2 text-fg-muted hover:bg-bg-muted hover:text-fg"
        aria-label="Switch language"
        @click="toggleLocale"
      >
        <Languages class="size-5" />
      </button>
    </div>

    <div class="flex min-h-dvh flex-col px-6 pb-10 pt-[112px] sm:pt-[128px]">
      <div class="mx-auto w-full max-w-[384px]">
        <h1
          class="text-[26px] font-semibold leading-[1.1] tracking-[-0.5px] sm:text-[30px]"
        >
          {{ t('auth.createAccount') }}
        </h1>
        <p class="mt-3 text-[14px] text-fg-muted">{{ t('auth.registerSubtitle') }}</p>

        <!-- 注册被后端关闭：不画表单，画说明 -->
        <div
          v-if="!registerEnabled"
          class="mt-10 rounded-[6px] border border-border p-4 text-[13.5px] text-fg-muted"
        >
          {{ t('auth.registerDisabled') }}
        </div>

        <template v-else>
          <form class="mt-10 space-y-4" @submit.prevent="onSubmit">
            <div class="space-y-2">
              <label for="reg-username" class="block text-[13px] text-fg-muted">
                {{ t('auth.username') }}
              </label>
              <input
                id="reg-username"
                v-model="username"
                type="text"
                autocomplete="username"
                required
                :maxlength="USERNAME_MAX"
                :placeholder="t('auth.usernamePlaceholder')"
                :class="INPUT_CLASS"
                :aria-invalid="usernameInvalid"
                @input="onUsernameInput"
              />
              <p v-if="usernameInvalid" class="text-[12.5px] text-danger-fg">
                {{ t('auth.usernameInvalid') }}
              </p>
              <p v-else class="text-[12px] text-fg-subtle">{{ t('auth.usernameRule') }}</p>
            </div>

            <!-- 邮箱验证码：后端开了 email_verification 才是必填流程 -->
            <template v-if="emailVerification">
              <div class="space-y-2">
                <label for="reg-email" class="block text-[13px] text-fg-muted">
                  {{ t('auth.email') }}
                </label>
                <input
                  id="reg-email"
                  v-model="email"
                  type="email"
                  autocomplete="email"
                  required
                  :placeholder="t('auth.emailPlaceholder')"
                  :class="INPUT_CLASS"
                />
              </div>

              <div class="space-y-2">
                <label for="reg-code" class="block text-[13px] text-fg-muted">
                  {{ t('auth.verificationCode') }}
                </label>
                <div class="flex gap-2">
                  <input
                    id="reg-code"
                    v-model="code"
                    type="text"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    required
                    :placeholder="t('auth.codePlaceholder')"
                    :class="INPUT_CLASS"
                    class="flex-1"
                  />
                  <button
                    type="button"
                    :disabled="sending || cooldown > 0"
                    class="motion-press h-10 shrink-0 rounded-[6px] border border-border px-3 text-[13px] font-medium text-fg hover:border-border-strong hover:bg-bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    @click="onSendCode"
                  >
                    {{ cooldown > 0 ? `${cooldown}s` : t('auth.sendCode') }}
                  </button>
                </div>
              </div>
            </template>

            <div class="space-y-2">
              <label for="reg-password" class="block text-[13px] text-fg-muted">
                {{ t('auth.password') }}
              </label>
              <PasswordInput
                id="reg-password"
                v-model="password"
                variant="auth"
                autocomplete="new-password"
                required
                :maxlength="PASSWORD_MAX"
                :placeholder="t('auth.passwordPlaceholder')"
                :aria-invalid="passwordInvalid"
              />
              <p v-if="passwordInvalid" class="text-[12.5px] text-danger-fg">
                {{ t('auth.passwordInvalid') }}
              </p>
              <p v-else class="text-[12px] text-fg-subtle">{{ t('auth.passwordRule') }}</p>
            </div>

            <div class="space-y-2">
              <label for="reg-password2" class="block text-[13px] text-fg-muted">
                {{ t('auth.confirmPassword') }}
              </label>
              <PasswordInput
                id="reg-password2"
                v-model="password2"
                variant="auth"
                autocomplete="new-password"
                required
                :placeholder="t('auth.passwordPlaceholder')"
                :aria-invalid="mismatch"
              />
              <p v-if="mismatch" class="text-[12.5px] text-danger-fg">
                {{ t('auth.passwordMismatch') }}
              </p>
            </div>

            <!-- 人机验证开着但前端没接组件，如实说明，别让用户填完才失败 -->
            <p
              v-if="turnstileEnabled"
              class="rounded-[6px] border border-border p-3 text-[12.5px] text-fg-muted"
            >
              {{ t('auth.turnstileNotice') }}
            </p>

            <button
              type="submit"
              :disabled="!canSubmit"
              class="motion-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px] bg-btn-primary-bg text-[14px] font-semibold text-btn-primary-fg hover:-translate-y-px hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
              {{ t('auth.signUp') }}
            </button>
          </form>

          <p class="mt-4 text-center text-[14px] text-fg-muted">
            {{ t('auth.hasAccount') }}
            <RouterLink to="/login" class="text-fg transition-opacity hover:opacity-70">
              {{ t('auth.signIn') }}
            </RouterLink>
          </p>

          <template v-if="oauthProviders.length">
            <div class="my-8 flex items-center gap-4">
              <span class="h-px flex-1 bg-border" />
              <span class="text-[14px] text-fg-muted">{{ t('auth.or') }}</span>
              <span class="h-px flex-1 bg-border" />
            </div>

            <div class="space-y-3">
              <a
                v-for="p in oauthProviders"
                :key="p"
                :href="oauthUrl(p)"
                class="motion-press flex h-10 w-full items-center justify-center gap-2.5 rounded-[6px] border border-border bg-bg-muted px-3 text-[14px] font-medium text-fg hover:border-border-strong"
              >
                <ProviderIcon :name="p" />
                {{ t('auth.signInWith', { provider: t(`auth.provider.${p}`) }) }}
              </a>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>
