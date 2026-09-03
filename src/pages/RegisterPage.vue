<script setup lang="ts">
/**
 * 注册页 —— 版式与登录页严格一致（同一个黑底、同一列宽 384、同样的控件尺寸），
 * infron 的两页也是同一套壳，只换标题和字段。
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
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { LoaderCircle, Languages } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { register } from '@/api/auth'
import { sendEmailCode } from '@/api/account'
import { ApiError } from '@/api/types'
import ProviderIcon from '@/components/auth/ProviderIcon.vue'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import { setLocale } from '@/i18n'
import { clearAffCode, readAffCode } from '@/utils/aff-code'

const site = useSiteStore()
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

onMounted(() => document.documentElement.classList.add('login-dark'))
onUnmounted(() => document.documentElement.classList.remove('login-dark'))

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

const canSubmit = computed(
  () =>
    !submitting.value &&
    username.value.trim().length > 0 &&
    password.value.length > 0 &&
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
  'h-10 w-full rounded-[6px] border border-[#2e2e2e] bg-transparent px-3 text-[14px] text-[#f2f2f2] outline-none transition-colors placeholder:text-[#6b6b6b] focus:border-[#5a5a5a]'
</script>

<template>
  <div class="relative min-h-dvh bg-black text-[#f2f2f2] antialiased">
    <RouterLink
      to="/"
      class="absolute left-6 top-6 z-10 flex items-center gap-2 transition-opacity hover:opacity-70 sm:left-10"
    >
      <img :src="logo" :alt="systemName" class="h-6 w-auto" />
      <span class="text-[17px] font-semibold tracking-tight">{{ systemName }}</span>
    </RouterLink>

    <!-- 右上角语言切换：海外站，每个页面都必须能切语言 -->
    <button
      type="button"
      class="motion-press absolute right-6 top-6 z-10 rounded-full p-2 text-[#8a8a8a] hover:bg-white/10 hover:text-[#f2f2f2] sm:right-10"
      aria-label="Switch language"
      @click="toggleLocale"
    >
      <Languages class="size-5" />
    </button>

    <div class="flex min-h-dvh flex-col px-6 pb-10 pt-[112px] sm:pt-[128px]">
      <div class="mx-auto w-full max-w-[384px]">
        <h1
          class="text-[26px] font-semibold leading-[1.1] tracking-[-0.5px] sm:text-[30px]"
        >
          {{ t('auth.createAccount') }}
        </h1>
        <p class="mt-3 text-[14px] text-[#8a8a8a]">{{ t('auth.registerSubtitle') }}</p>

        <!-- 注册被后端关闭：不画表单，画说明 -->
        <div
          v-if="!registerEnabled"
          class="mt-10 rounded-[6px] border border-[#2e2e2e] p-4 text-[13.5px] text-[#8a8a8a]"
        >
          {{ t('auth.registerDisabled') }}
        </div>

        <template v-else>
          <form class="mt-10 space-y-4" @submit.prevent="onSubmit">
            <div class="space-y-2">
              <label for="reg-username" class="block text-[13px] text-[#8a8a8a]">
                {{ t('auth.username') }}
              </label>
              <input
                id="reg-username"
                v-model="username"
                type="text"
                autocomplete="username"
                required
                :placeholder="t('auth.usernamePlaceholder')"
                :class="INPUT_CLASS"
              />
            </div>

            <!-- 邮箱验证码：后端开了 email_verification 才是必填流程 -->
            <template v-if="emailVerification">
              <div class="space-y-2">
                <label for="reg-email" class="block text-[13px] text-[#8a8a8a]">
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
                <label for="reg-code" class="block text-[13px] text-[#8a8a8a]">
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
                    class="motion-press h-10 shrink-0 rounded-[6px] border border-[#2e2e2e] px-3 text-[13px] font-medium hover:border-[#5a5a5a] hover:bg-[#141414] disabled:cursor-not-allowed disabled:opacity-50"
                    @click="onSendCode"
                  >
                    {{ cooldown > 0 ? `${cooldown}s` : t('auth.sendCode') }}
                  </button>
                </div>
              </div>
            </template>

            <div class="space-y-2">
              <label for="reg-password" class="block text-[13px] text-[#8a8a8a]">
                {{ t('auth.password') }}
              </label>
              <PasswordInput
                id="reg-password"
                v-model="password"
                variant="dark"
                autocomplete="new-password"
                required
                :placeholder="t('auth.passwordPlaceholder')"
              />
            </div>

            <div class="space-y-2">
              <label for="reg-password2" class="block text-[13px] text-[#8a8a8a]">
                {{ t('auth.confirmPassword') }}
              </label>
              <PasswordInput
                id="reg-password2"
                v-model="password2"
                variant="dark"
                autocomplete="new-password"
                required
                :placeholder="t('auth.passwordPlaceholder')"
                :aria-invalid="mismatch"
              />
              <p v-if="mismatch" class="text-[12.5px] text-[#f87171]">
                {{ t('auth.passwordMismatch') }}
              </p>
            </div>

            <!-- 人机验证开着但前端没接组件，如实说明，别让用户填完才失败 -->
            <p
              v-if="turnstileEnabled"
              class="rounded-[6px] border border-[#2e2e2e] p-3 text-[12.5px] text-[#8a8a8a]"
            >
              {{ t('auth.turnstileNotice') }}
            </p>

            <button
              type="submit"
              :disabled="!canSubmit"
              class="motion-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px] bg-[#111a2e] text-[14px] font-semibold text-white hover:-translate-y-px hover:bg-[#182541] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
              {{ t('auth.signUp') }}
            </button>
          </form>

          <p class="mt-4 text-center text-[14px] text-[#8a8a8a]">
            {{ t('auth.hasAccount') }}
            <RouterLink
              to="/login"
              class="text-[#f2f2f2] transition-opacity hover:opacity-70"
            >
              {{ t('auth.signIn') }}
            </RouterLink>
          </p>

          <template v-if="oauthProviders.length">
            <div class="my-8 flex items-center gap-4">
              <span class="h-px flex-1 bg-[#2e2e2e]" />
              <span class="text-[14px] text-[#8a8a8a]">{{ t('auth.or') }}</span>
              <span class="h-px flex-1 bg-[#2e2e2e]" />
            </div>

            <div class="space-y-3">
              <a
                v-for="p in oauthProviders"
                :key="p"
                :href="oauthUrl(p)"
                class="motion-press flex h-10 w-full items-center justify-center gap-2.5 rounded-[6px] border border-[#2e2e2e] px-3 text-[14px] font-medium text-[#f2f2f2] hover:border-[#5a5a5a] hover:bg-[#141414]"
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

<style>
html.login-dark,
html.login-dark body {
  background-color: #000;
}
</style>
