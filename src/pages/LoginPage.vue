<script setup lang="ts">
/**
 * 登录页 —— 照搬 infron.ai/login 的版式：
 *
 *   页面      纯黑通屏（infron 实测 body background rgb(0,0,0)），
 *             不跟随全站主题切换 —— infron 的登录页恒为深色。
 *   logo      左上角 x40 / y24，白色单行
 *   表单列    宽 384px，水平居中；标题 y≈140
 *   标题      逐字打字机 + 品牌渐变 + 闪烁光标（见 TypewriterText）。
 *             infron 原样是静态 "Welcom"，这里按需求改成
 *             "Welcome to llmuni" 的动效版。标题写死不走站名变量 ——
 *             后端的 system_name 可能还是旧名，接在 "Welcome to"
 *             后面中英混排很难看，且会撑破 384 列宽。
 *   字号      按 384 列宽反推："Welcome to llmuni" 18 字符，
 *             30px/600 下约 268px，加光标仍有富余。
 *   字段      label 12px 灰 → 输入框高 40px，radius 6px，深灰描边
 *   主按钮    高 40px，深蓝近黑 #111a2e，白字 14px/600
 *   次链接    14px 灰，居中，无下划线
 *   OR        左右 1px 线夹居中文字，14px 灰
 *   OAuth     高 40px 描边按钮，图标+文字水平居中，
 *             右端 "last used" 徽章（仅上次用过的那个）
 *   页脚      条款 | 隐私，14px 带下划线，y≈712
 *
 * 与 infron 的差异（后端能力决定，不是随意发挥）：
 *   - infron 首屏是邮箱验证码登录，我们后端是用户名+密码，
 *     故默认展示密码表单，把「邮箱登录」做成次级链接位（后端开了才显示）。
 *   - OAuth 只渲染 /api/status 真开的厂商，没开就不画空按钮。
 *   - "last used" 从 localStorage 读上次成功的方式，没有就不显示徽章。
 *   - 注册/忘记密码/条款/隐私四个页面尚未实现，故这些入口暂不渲染 ——
 *     链到 404 比不放链接更糟。路由建好后把 HAS_* 常量翻成 true 即可。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import { LoaderCircle, Languages } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useUserStore } from '@/stores/user'
import { ApiError } from '@/api/types'
import ProviderIcon from '@/components/auth/ProviderIcon.vue'
import TypewriterText from '@/components/common/TypewriterText.vue'
import { setLocale } from '@/i18n'

const site = useSiteStore()
const user = useUserStore()
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
  // 黑底铺到 <html>，否则 body 的白会从滚动边缘漏出来
  document.documentElement.classList.add('login-dark')
  try {
    lastUsed.value = localStorage.getItem(LAST_KEY)
  } catch {
    lastUsed.value = null
  }
})
onUnmounted(() => {
  document.documentElement.classList.remove('login-dark')
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
  <!--
    强制深色：登录页不消费全站 token，直接写死黑底，
    否则浅色主题下会变成一张白纸，和 infron 完全不是一个东西。
    黑底同时铺到 <html>（见下方 style），只给这个 div 上色的话，
    橡皮筋滚动和窄屏下 body 的白会从边缘漏出来。
  -->
  <div class="relative min-h-dvh bg-black text-[#f2f2f2] antialiased">
    <!-- 左上角 logo：x40 y24，与 infron 一致 -->
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
      <!-- 表单列：定宽 384，水平居中 -->
      <div class="mx-auto w-full max-w-[384px]">
        <h1
          class="text-[26px] font-semibold leading-[1.1] tracking-[-0.5px] sm:text-[30px]"
        >
          <TypewriterText text="Welcome to llmuni" />
        </h1>

        <form class="mt-12 space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <label for="username" class="block text-[13px] text-[#8a8a8a]">
              {{ t('auth.username') }}
            </label>
            <input
              id="username"
              v-model="username"
              type="text"
              autocomplete="username"
              required
              :placeholder="t('auth.usernamePlaceholder')"
              class="h-10 w-full rounded-[6px] border border-[#2e2e2e] bg-transparent px-3 text-[14px] text-[#f2f2f2] outline-none transition-colors placeholder:text-[#6b6b6b] focus:border-[#5a5a5a]"
            />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label for="password" class="block text-[13px] text-[#8a8a8a]">
                {{ t('auth.password') }}
              </label>
              <RouterLink
                v-if="HAS_RESET_PAGE"
                to="/reset"
                class="text-[13px] text-[#8a8a8a] transition-colors hover:text-[#f2f2f2]"
              >
                {{ t('auth.forgotPassword') }}
              </RouterLink>
            </div>
            <input
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              :placeholder="t('auth.passwordPlaceholder')"
              class="h-10 w-full rounded-[6px] border border-[#2e2e2e] bg-transparent px-3 text-[14px] text-[#f2f2f2] outline-none transition-colors placeholder:text-[#6b6b6b] focus:border-[#5a5a5a]"
            />
          </div>

          <!-- 主按钮：infron 的深蓝近黑，不是品牌亮蓝 -->
          <button
            type="submit"
            :disabled="submitting || !passwordLoginEnabled"
            class="motion-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-[6px] bg-[#111a2e] text-[14px] font-semibold text-white hover:-translate-y-px hover:bg-[#182541] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LoaderCircle v-if="submitting" class="size-4 animate-spin" />
            {{ t('auth.signIn') }}
          </button>
        </form>

        <!-- 注册入口：后端关了注册、或注册页还没建，都不显示 -->
        <p v-if="showRegister" class="mt-4 text-center text-[14px] text-[#8a8a8a]">
          {{ t('auth.noAccount') }}
          <RouterLink
            to="/register"
            class="text-[#f2f2f2] transition-opacity hover:opacity-70"
          >
            {{ t('auth.signUp') }}
          </RouterLink>
        </p>

        <!-- OR 分隔线：只有真有第三方登录时才画，否则是条没用的线 -->
        <template v-if="providers.length">
          <div class="my-8 flex items-center gap-4">
            <span class="h-px flex-1 bg-[#2e2e2e]" />
            <span class="text-[14px] text-[#8a8a8a]">{{ t('auth.or') }}</span>
            <span class="h-px flex-1 bg-[#2e2e2e]" />
          </div>

          <div class="space-y-3">
            <a
              v-for="p in providers"
              :key="p"
              :href="oauthUrl(p)"
              class="motion-press relative flex h-10 w-full items-center justify-center gap-2.5 rounded-[6px] border border-[#2e2e2e] px-3 text-[14px] font-medium text-[#f2f2f2] hover:border-[#5a5a5a] hover:bg-[#141414]"
              @click="remember(p)"
            >
              <ProviderIcon :name="p" />
              {{ t('auth.signInWith', { provider: t(`auth.provider.${p}`) }) }}
              <span
                v-if="lastUsed === p"
                class="absolute right-3 rounded-[4px] bg-[#2e2e2e] px-1.5 py-0.5 text-[11px] font-normal text-[#b6b6b6]"
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
        class="mt-auto pt-16 text-center text-[14px] text-[#8a8a8a]"
      >
        <RouterLink to="/terms" class="underline transition-colors hover:text-[#f2f2f2]">
          {{ t('auth.terms') }}
        </RouterLink>
        <span class="px-3 text-[#4a4a4a]">|</span>
        <RouterLink to="/privacy" class="underline transition-colors hover:text-[#f2f2f2]">
          {{ t('auth.privacy') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<style>
/*
 * 非 scoped：要够到 <html>/<body>。
 * 登录页挂载时给 html 打上标记类，卸载时撤掉（见 onMounted/onUnmounted），
 * 这样黑底只在本页生效，不污染其他路由。
 */
html.login-dark,
html.login-dark body {
  background-color: #000;
}
</style>
