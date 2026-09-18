<script setup lang="ts">
/**
 * 登录页 —— 照搬 infron.ai/login 的版式：
 *
 *   页面      占满全屏，底色/文字跟随全站主题（见下方「主题」一段）
 *   logo      左上角 x40 / y24
 *   表单列    宽 384px，水平居中；标题 y≈140
 *   标题      逐字打字机 + 品牌渐变 + 闪烁光标（见 TypewriterText）。
 *             infron 原样是静态 "Welcom"，这里按需求改成
 *             "Welcome to llmuni" 的动效版。标题写死不走站名变量 ——
 *             后端的 system_name 可能还是旧名，接在 "Welcome to"
 *             后面中英混排很难看，且会撑破 384 列宽。
 *   字号      按 384 列宽反推："Welcome to llmuni" 18 字符，
 *             30px/600 下约 268px，加光标仍有富余。
 *   字段      label 12px 灰 → 输入框高 40px，radius 6px，描边
 *   主按钮    高 40px，白字 14px/600
 *   次链接    14px 灰，居中，无下划线
 *   OR        左右 1px 线夹居中文字，14px 灰
 *   OAuth     高 40px 描边按钮，图标+文字水平居中，
 *             右端 "last used" 徽章（仅上次用过的那个）
 *   页脚      条款 | 隐私，14px 带下划线，y≈712
 *
 * 主题：登录/注册页原先是写死的纯黑（对齐 infron，它的登录页恒为深色），
 * 但那导致选了浅色主题的用户一进登录页就掉进黑屏。现在改为消费全站 token，
 * 亮/暗跟着 theme store 走，与站内其他页面一致。色值一律走 token 类
 * （bg-bg / text-fg / border-border …），不能再写 #xxxxxx —— 写死一个就等于
 * 把这个页面从主题体系里摘出去。
 *
 * 与 infron 的差异（后端能力决定，不是随意发挥）：
 *   - infron 首屏是邮箱验证码登录，我们后端是用户名+密码，
 *     故默认展示密码表单，把「邮箱登录」做成次级链接位（后端开了才显示）。
 *   - OAuth 只渲染 /api/status 真开的厂商，没开就不画空按钮。
 *   - "last used" 从 localStorage 读上次成功的方式，没有就不显示徽章。
 *   - 注册/忘记密码/条款/隐私四个页面尚未实现，故这些入口暂不渲染 ——
 *     链到 404 比不放链接更糟。路由建好后把 HAS_* 常量翻成 true 即可。
 */
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import { LoaderCircle, Languages, Sun, Moon } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { useThemeStore } from '@/stores/theme'
import { ApiError } from '@/api/types'
import ProviderIcon from '@/components/auth/ProviderIcon.vue'
import TypewriterText from '@/components/common/TypewriterText.vue'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import { setLocale } from '@/i18n'

const site = useSiteStore()
const user = useUserStore()
const theme = useThemeStore()
const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const { systemName, logo, registerEnabled, passwordLoginEnabled, oauthProviders } =
  storeToRefs(site)

function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}

const username = ref('')
const password = ref('')
const submitting = ref(false)

/** 上次成功登录用的方式，用于 "last used" 徽章；无记录则不显示 */
const LAST_KEY = 'onestep:last-login-method'
const lastUsed = ref<string | null>(null)
onMounted(() => {
  try {
    lastUsed.value = localStorage.getItem(LAST_KEY)
  } catch {
    lastUsed.value = null
  }
})
function remember(method: string) {
  try {
    localStorage.setItem(LAST_KEY, method)
  } catch {
    /* 隐私模式下 localStorage 会抛，忽略即可 */
  }
}

/** OAuth 跳转交给后端处理，前端只负责带上回跳地址 */
function oauthUrl(p: string) {
  const redirect =
    typeof route.query.redirect === 'string' ? route.query.redirect : '/console'
  return `/api/oauth/${p}?redirect=${encodeURIComponent(redirect)}`
}

const providers = computed(() => oauthProviders.value)

/**
 * 这几个页面还没建路由。链到不存在的路径会掉进 404，
 * 比暂时不显示更糟，故用常量卡住；建好后改 true 即可。
 * /register 已建（见 router/index.ts），故开了第一个。
 */
const HAS_REGISTER_PAGE = true
const HAS_RESET_PAGE = false
const HAS_LEGAL_PAGES = false

const showRegister = computed(() => HAS_REGISTER_PAGE && registerEnabled.value)

async function onSubmit() {
  if (submitting.value) return
  submitting.value = true
  try {
    await user.login(username.value, password.value)
    remember('password')
    toast.success(t('auth.loginSuccess'))
    const redirect = route.query.redirect
    await router.replace(typeof redirect === 'string' ? redirect : '/console')
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
</script>

<template>
  <!-- 底色/文字全走 token：亮色主题下是一张干净的白纸，暗色下才是黑底 -->
  <div class="relative min-h-dvh bg-bg text-fg antialiased">
    <!-- 左上角 logo：x40 y24，与 infron 一致 -->
    <RouterLink
      to="/"
      class="absolute left-6 top-6 z-10 flex items-center gap-2 transition-opacity hover:opacity-70 sm:left-10"
    >
      <img :src="logo" :alt="systemName" class="h-6 w-auto" />
      <span class="text-[17px] font-semibold tracking-tight">{{ systemName }}</span>
    </RouterLink>

    <!-- 右上角：主题 + 语言。登录页没有站点顶栏，这两个开关必须自带 ——
         没有主题开关的话，用户在浅色站里也切不了这两个页面的主题。 -->
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
      <!-- 表单列：定宽 384，水平居中 -->
      <div class="mx-auto w-full max-w-[384px]">
        <h1
          class="text-[26px] font-semibold leading-[1.1] tracking-[-0.5px] sm:text-[30px]"
        >
          <TypewriterText text="Welcome to llmuni" />
        </h1>

        <form class="mt-12 space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <label for="username" class="block text-[13px] text-fg-muted">
              {{ t('auth.username') }}
            </label>
            <input
              id="username"
              v-model="username"
              type="text"
              autocomplete="username"
              required
              :placeholder="t('auth.usernamePlaceholder')"
              class="h-10 w-full rounded-[6px] border border-border bg-transparent px-3 text-[14px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-border-selected"
            />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label for="password" class="block text-[13px] text-fg-muted">
                {{ t('auth.password') }}
              </label>
              <RouterLink
                v-if="HAS_RESET_PAGE"
                to="/reset"
                class="text-[13px] text-fg-muted transition-colors hover:text-fg"
              >
                {{ t('auth.forgotPassword') }}
              </RouterLink>
            </div>
            <PasswordInput
              id="password"
              v-model="password"
              variant="auth"
              autocomplete="current-password"
              required
              :placeholder="t('auth.passwordPlaceholder')"
            />
          </div>

          <!-- 主按钮：token 化的「主按钮」底 —— 浅色下是近黑深底白字，
               暗色下自动反成白底黑字，两边都过 AA -->
          <button
            type="submit"
            :disabled="submitting || !passwordLoginEnabled"
            class="motion-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px] bg-btn-primary-bg text-[14px] font-semibold text-btn-primary-fg hover:-translate-y-px hover:bg-btn-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
            {{ t('auth.signIn') }}
          </button>
        </form>

        <!-- 注册入口：后端关了注册、或注册页还没建，都不显示 -->
        <p v-if="showRegister" class="mt-4 text-center text-[14px] text-fg-muted">
          {{ t('auth.noAccount') }}
          <RouterLink to="/register" class="text-fg transition-opacity hover:opacity-70">
            {{ t('auth.signUp') }}
          </RouterLink>
        </p>

        <!-- OR 分隔线：只有真有第三方登录时才画，否则是条没用的线 -->
        <template v-if="providers.length">
          <div class="my-8 flex items-center gap-4">
            <span class="h-px flex-1 bg-border" />
            <span class="text-[14px] text-fg-muted">{{ t('auth.or') }}</span>
            <span class="h-px flex-1 bg-border" />
          </div>

          <div class="space-y-3">
            <a
              v-for="p in providers"
              :key="p"
              :href="oauthUrl(p)"
              class="motion-press relative flex h-10 w-full items-center justify-center gap-2.5 rounded-[6px] border border-border bg-bg-muted px-3 text-[14px] font-medium text-fg hover:border-border-strong"
              @click="remember(p)"
            >
              <ProviderIcon :name="p" />
              {{ t('auth.signInWith', { provider: t(`auth.provider.${p}`) }) }}
              <span
                v-if="lastUsed === p"
                class="absolute right-3 rounded-[4px] bg-bg-inset px-1.5 py-0.5 text-[11px] font-normal text-fg-muted"
              >
                {{ t('auth.lastUsed') }}
              </span>
            </a>
          </div>
        </template>
      </div>

      <!-- 页脚：条款 | 隐私，推到底部；页面未建时整条不渲染 -->
      <div
        v-if="HAS_LEGAL_PAGES"
        class="mt-auto pt-16 text-center text-[14px] text-fg-muted"
      >
        <RouterLink to="/terms" class="underline transition-colors hover:text-fg">
          {{ t('auth.terms') }}
        </RouterLink>
        <span class="px-3 text-fg-subtle">|</span>
        <RouterLink to="/privacy" class="underline transition-colors hover:text-fg">
          {{ t('auth.privacy') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>
