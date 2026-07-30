<script setup lang="ts">
/**
 * 悬浮导航 —— 尺寸取自 infron.ai 线上实测（CDP）：
 *   容器  x80 y24 宽 1258 高 80，padding 13px 40px
 *         → logo 实际横坐标 80+40 = 120，与 hero 的 h1(x120) 同一根竖线
 *   圆角  0 50px 50px 0（左侧直角贴边，右侧半圆）
 *   导航  16px / weight 400 / 项间距 52px
 *   右侧  主 CTA 与次 CTA 高 40px
 * 注意是浮动的独立药丸，不是通栏 header。
 *
 * 宽屏行为按 1878px 实测 infron 复核：
 *   h1        x120        —— hero 文案钉在左侧 120px，不居中
 *   Login 按钮 x1668 w90  —— 即右端收在 x1758
 *   正文       1100@389   —— 页面主体才是 1100 定宽居中（实测出现 22 次）
 *
 * 关键：白色药丸是「贴左边通栏 + 右端在按钮后收口」，不是拉满整行。
 * 药丸右侧之外能看到 hero 渐变，这是 infron 视觉的一部分；
 * 拉满会把渐变整条盖掉（曾经的错误做法）。
 * 故 header 用 flex 让药丸按内容宽度收缩，右侧留白透出渐变。
 *
 * 滚动后转为吸顶通栏：hero 之外的区块背景是白的，
 * 不加底色会和内容糊在一起，故滚动态补 border + shadow。
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { Sun, Moon, Languages, LogIn, Menu, X } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useThemeStore } from '@/stores/theme'
import { useUserStore } from '@/stores/user'
import { setLocale } from '@/i18n'

const site = useSiteStore()
const theme = useThemeStore()
const user = useUserStore()
const { systemName, logo } = storeToRefs(site)
const { isDark } = storeToRefs(theme)
const { locale, t } = useI18n()

const mobileOpen = ref(false)

/** 滚过 24px（浮动药丸原本的 top 偏移）就切成吸顶态 */
const scrolled = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 24
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

const navItems = [
  { key: 'models', to: '/models' },
  { key: 'docs', to: '/docs' },
  { key: 'pricing', to: '/pricing' },
  { key: 'rankings', to: '/rankings' },
  { key: 'about', to: '/about' },
] as const

function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}
</script>

<template>
  <header
    class="pointer-events-none fixed inset-x-0 top-0 z-50 transition-[top] duration-200"
    :class="scrolled ? 'lg:top-0' : 'lg:top-6'"
  >
    <!--
      未吸顶：药丸贴左通栏，右端在登录按钮之后收口（留 80px 透出 hero 渐变）。
      吸顶：撑满整行变成通栏条。
    -->
    <div class="flex" :class="scrolled ? '' : 'lg:pr-20'">
      <!--
        浮动药丸：右侧 50px 半圆。
        左内边距 120px 而不是 infron 的 40px —— infron 的药丸本体从 x80 起，
        80+40=120 才是 logo 的真实横坐标，正好和 hero 的 h1 对齐。
        我们的药丸是通栏（x0，滚动后要变整条），所以把那 80px 折进 padding，
        结果一致：logo 落在 x120。xl 以下收回 40px，hero 同步，保证任何宽度都对齐。

        右内边距：未吸顶时外层 pr-20(80) + 药丸 pr-10(40) = 120；
        吸顶时外层不留白，故药丸自己补到 120 —— 登录按钮滚动时不会左右跳。
      -->
      <div
        class="pointer-events-auto flex h-[76px] w-full items-center bg-bg px-6 transition-[border-radius] duration-200 lg:h-20 lg:pl-10 lg:py-[13px] xl:pl-[120px]"
        :class="
          scrolled
            ? 'border-b border-border shadow-sm lg:rounded-none lg:pr-10 xl:pr-[120px]'
            : 'lg:rounded-r-[50px] lg:pr-10'
        "
      >
        <RouterLink to="/" class="flex shrink-0 items-center gap-2.5">
          <img :src="logo" :alt="systemName" class="h-5 w-auto" />
          <span class="text-[17px] font-semibold tracking-tight">{{ systemName }}</span>
        </RouterLink>

        <nav class="ml-auto hidden items-center gap-[52px] lg:flex">
          <RouterLink
            v-for="item in navItems"
            :key="item.key"
            :to="item.to"
            class="text-[16px] font-normal tracking-[-0.16px] text-fg transition-opacity hover:opacity-60"
          >
            {{ t(`nav.${item.key}`) }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex items-center gap-3 lg:ml-[60px]">
          <button
            class="hidden rounded-full p-2 text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg sm:block"
            :aria-label="t('theme.' + (isDark ? 'light' : 'dark'))"
            @click="theme.toggle()"
          >
            <component :is="isDark ? Sun : Moon" class="size-4.5" />
          </button>
          <button
            class="hidden rounded-full p-2 text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg sm:block"
            aria-label="Switch language"
            @click="toggleLocale"
          >
            <Languages class="size-4.5" />
          </button>

          <!-- 主 CTA：黑底药丸，radius 20px -->
          <RouterLink
            to="/console"
            class="hidden h-10 items-center rounded-[20px] bg-btn-primary-bg px-[18px] text-[16px] font-normal text-btn-primary-fg transition-opacity hover:opacity-88 sm:inline-flex"
          >
            {{ t('home.nav.cta') }}
          </RouterLink>

          <!-- 次 CTA：描边药丸，radius 100px -->
          <RouterLink
            :to="user.isLoggedIn ? '/console' : '/login'"
            class="inline-flex h-10 items-center gap-2 rounded-[100px] border border-border-strong px-[18px] text-[16px] font-normal transition-colors hover:bg-bg-muted"
          >
            {{ user.isLoggedIn ? t('nav.console') : t('auth.signIn') }}
            <LogIn class="size-3.5" />
          </RouterLink>

          <button
            class="rounded-full p-2 text-fg-muted transition-colors hover:bg-bg-muted lg:hidden"
            aria-label="Menu"
            @click="mobileOpen = !mobileOpen"
          >
            <component :is="mobileOpen ? X : Menu" class="size-5" />
          </button>
        </div>
      </div>

      <!-- 移动端展开菜单 -->
      <div
        v-if="mobileOpen"
        class="pointer-events-auto mx-4 mt-2 rounded-2xl border border-border bg-bg-elevated p-2 shadow-lg lg:hidden"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="block rounded-xl px-4 py-3 text-sm text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
          @click="mobileOpen = false"
        >
          {{ t(`nav.${item.key}`) }}
        </RouterLink>
      </div>
    </div>
  </header>
</template>
