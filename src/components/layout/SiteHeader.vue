<script setup lang="ts">
/**
 * 站点导航 —— 版式对齐参考站 api.openlux.ai：
 *
 *   **悬浮**的浅蓝渐变药丸：四周留出间隙、圆角收边、半透明 + 背景模糊，
 *   浮在页面内容之上而不是焊死在顶边；
 *   左 logo / 中导航 / 右操作区三段式；导航真正居中，当前页高亮成品牌蓝
 *   并带一条下划线；右侧主题、语言两个图标用品牌蓝，后面跟
 *   「登录 / 注册」两枚蓝色药丸。
 *
 * 三段式用 1fr_auto_1fr 网格：中间列宽度自适应内容，被两侧等宽的 1fr
 * 挤到正中 —— 这样导航居中与左右两侧内容多长无关。用 flex + ml-auto
 * 做不到这点（导航会被两侧内容推偏）。
 *
 * 悬浮 ≠ 收窄。药丸靠 mx-3/lg:mx-5 的小外边距浮起来，**不设 max-width**：
 * lg 下 logo 距页边 20+28=48px，跟参考站的 x≈40 基本齐平。别再套
 * max-w-[1400px] 去跟 hero 容器对齐 —— 参考站两者本就不对齐（它 header
 * logo 在 x≈57，hero 字标在 x≈128），套上之后在 1920 宽屏下 logo 会缩到
 * 330px 处，整条横幅中间空一大片，一眼就不像。
 *
 * 高度：药丸本体 68px / lg 72px，加上 10px / lg 12px 的上边距，整体占位
 * 78px / lg 84px —— 与原来通栏条的 76 / 80 基本持平。各公开页顶部留白
 * （如 hero 的 pt-[104px] lg:pt-[132px]）按 76/80 配的，仍有 20px+ 余量，
 * 不必逐页改。但别把药丸再加高：留白是硬编码的，超了就压到内容。
 *
 * 底色带 alpha + backdrop-blur：首页的鼠标跟随光晕铺满整页（见
 * NewHomePage.vue），不透明底色会把顶栏这一条切成死板的横杠。
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { Sun, Moon, Languages, Menu, X, Bell } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import MessageCenter from '@/components/layout/MessageCenter.vue'
import { useThemeStore } from '@/stores/theme'
import { useUserStore } from '@/stores/user'
import { setLocale } from '@/i18n'

const site = useSiteStore()
const theme = useThemeStore()
const user = useUserStore()
const { systemName, logo, registerEnabled } = storeToRefs(site)
const { isDark } = storeToRefs(theme)
const { locale, t } = useI18n()

const mobileOpen = ref(false)

/** 消息中心（公告）面板开关 */
const messageOpen = ref(false)

/** 滚过顶部留白就加重投影，让悬浮药丸从滚动的内容里抬得更高 */
const scrolled = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 8
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  // 公开页（含首页）的路由 meta 没有 requiresAuth/guestOnly，路由守卫不会
  // 触发 ensureResolved —— 冷启动时 store 是空的，右上角会错显示「登录」。
  // 登录态在后端 session cookie 里，这里补确认一次；已确认过则是空操作。
  void user.ensureResolved()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

/**
 * exact：/ 必须精确匹配才算选中。RouterLink 默认的 active 是前缀匹配，
 * 而任何路径都以 / 开头 —— 不加这个开关，「首页」会在每一页都亮着。
 */
const navItems = computed(() =>
  [
    { key: 'home', to: '/', exact: true },
    { key: 'models', to: '/models', exact: false },
    { key: 'docs', to: '/docs', exact: false },
    // 价格页入口暂去，/pricing 路由保留
    { key: 'rankings', to: '/rankings', exact: false },
    { key: 'about', to: '/company', exact: false },
  ].filter((item) => site.hasNavModule(item.key)),
)

function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}

/** 主题 / 语言两个圆形图标钮：参考站是品牌蓝，不是灰色 */
const iconBtnCls =
  'motion-press rounded-full p-2 text-accent transition-colors hover:bg-accent-bg'
</script>

<template>
  <header class="pointer-events-none fixed inset-x-0 top-0 z-50">
    <!-- 悬浮药丸本体：四周留边、圆角收口、半透明 + 背景模糊。
         **不描边**：药丸有 1570px 宽、圆角只吃掉两端各 34px，一圈 border
         在屏幕上就是上下两道近乎通栏的硬线，比通栏横条还难看。
         悬浮感全交给投影 —— 投影是渐变衰减的，不会切出边缘。
         滚动后把投影加重一档，让它从滚动的内容里抬得更高。 -->
    <div
      class="pointer-events-auto mx-3 mt-2.5 rounded-full bg-[linear-gradient(90deg,rgba(233,240,255,0.82)_0%,rgba(249,251,255,0.78)_48%,rgba(235,243,255,0.82)_100%)] backdrop-blur-xl transition-shadow duration-200 lg:mx-5 lg:mt-3 dark:bg-[linear-gradient(90deg,rgba(12,19,34,0.82)_0%,rgba(11,15,24,0.78)_48%,rgba(12,21,38,0.82)_100%)]"
      :class="
        scrolled
          ? 'shadow-[0_12px_40px_-14px_rgba(10,141,255,0.34)]'
          : 'shadow-[0_8px_30px_-16px_rgba(10,141,255,0.26)]'
      "
    >
      <!-- 药丸内不再 max-w 收窄：靠外层 mx-* 浮起来就够了，
           logo/按钮仍贴近页边，中间留出足够的空当 -->
      <div
        class="mx-auto flex h-[68px] max-w-none items-center gap-4 px-5 lg:grid lg:h-[72px] lg:grid-cols-[1fr_auto_1fr] lg:px-7 xl:px-9"
      >
        <!-- 左：字标。比之前放大一档，对齐参考站的粗体 logo -->
        <RouterLink to="/" class="flex shrink-0 items-center gap-2.5">
          <img :src="logo" :alt="systemName" class="h-7 w-auto" />
          <span class="text-[22px] font-bold tracking-tight">{{ systemName }}</span>
        </RouterLink>

        <!-- 中：导航。被两侧 1fr 挤在正中 -->
        <nav class="hidden items-center gap-14 lg:flex">
          <RouterLink
            v-for="item in navItems"
            :key="item.key"
            :to="item.to"
            class="nav-link motion-press relative text-[16px] font-medium text-fg-secondary transition-colors hover:text-accent"
            :active-class="item.exact ? '' : 'nav-link--active'"
            exact-active-class="nav-link--active"
          >
            {{ t(`nav.${item.key}`) }}
          </RouterLink>
        </nav>

        <!-- 右：主题 / 语言 / 登录注册。
             图标自成一组挨紧（gap-0.5），与按钮之间才留空 —— 参考站的疏密关系。 -->
        <div class="ml-auto flex items-center gap-3">
          <div class="hidden items-center gap-0.5 sm:flex">
            <button
              :class="[iconBtnCls, 'relative']"
              :aria-label="t('notice.messageCenter')"
              @click="messageOpen = true"
            >
              <Bell class="size-[18px]" />
              <!-- 有新公告时的未读红点，见 store.hasNewNotice -->
              <span
                v-if="site.hasNewNotice"
                class="absolute right-1 top-1 size-1.5 rounded-full bg-danger-fg ring-2 ring-bg"
              />
            </button>
            <button :class="iconBtnCls" aria-label="Switch language" @click="toggleLocale">
              <Languages class="size-[18px]" />
            </button>
            <button
              :class="iconBtnCls"
              :aria-label="t('theme.' + (isDark ? 'light' : 'dark'))"
              @click="theme.toggle()"
            >
              <component :is="isDark ? Sun : Moon" class="size-[18px]" />
            </button>
          </div>

          <!-- 已登录时两枚按钮塌缩成一枚「控制台」，不再显示登录/注册 -->
          <RouterLink
            v-if="user.isLoggedIn"
            to="/console"
            class="auth-btn bg-accent text-white hover:bg-accent-hover"
          >
            {{ t('nav.console') }}
          </RouterLink>
          <template v-else>
            <!-- 两枚同色：参考站的 Sign in / Sign up 是同一个蓝，不分主次。
                 用 --color-accent(#005eff) 而不是更亮的 accent-solid(#0a8dff)：
                 后者配白字只有 3.35:1，15px 文字过不了 AA。 -->
            <RouterLink to="/login" class="auth-btn bg-accent text-white hover:bg-accent-hover">
              {{ t('auth.signIn') }}
            </RouterLink>
            <!-- 站点关闭注册时不挂这个入口：点进去只会撞上「未开放注册」 -->
            <RouterLink
              v-if="registerEnabled"
              to="/register"
              class="auth-btn hidden bg-accent text-white hover:bg-accent-hover sm:inline-flex"
            >
              {{ t('auth.signUp') }}
            </RouterLink>
          </template>

          <button
            class="motion-press rounded-full p-2 text-fg-muted hover:bg-bg-muted lg:hidden"
            aria-label="Menu"
            @click="mobileOpen = !mobileOpen"
          >
            <component :is="mobileOpen ? X : Menu" class="size-5" />
          </button>
        </div>
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
        class="motion-press block rounded-xl px-4 py-3 text-sm text-fg-muted hover:bg-bg-muted hover:text-fg"
        :active-class="item.exact ? '' : 'text-accent'"
        exact-active-class="text-accent"
        @click="mobileOpen = false"
      >
        {{ t(`nav.${item.key}`) }}
      </RouterLink>
    </div>

    <!-- 消息中心（公告）面板 -->
    <MessageCenter :open="messageOpen" @close="messageOpen = false" />
  </header>
</template>

<style scoped>
/* 下划线用 ::after 而不是 border-bottom —— 后者会把链接盒子撑高，
   一行里选中项和未选中项的基线就会错开。
   默认 opacity:0 藏起来，hover 与当前页（active）都显示，文字转成品牌蓝。
   颜色跟着 currentColor 走：hover 时 text-accent 生效，下划线便是同色。 */
.nav-link::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  bottom: -8px;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0;
  transition: opacity var(--duration-base) var(--ease-out);
}
.nav-link:hover::after,
.nav-link--active::after {
  opacity: 1;
}
.nav-link--active {
  color: var(--color-accent);
}

/* 登录 / 注册 / 控制台三枚药丸共用尺寸，只有底色不同 */
.auth-btn {
  display: inline-flex;
  height: 2.25rem;
  align-items: center;
  border-radius: 100px;
  padding-inline: 1.125rem;
  font-size: 15px;
  font-weight: 500;
  transition:
    background-color var(--duration-base) var(--ease-out),
    filter var(--duration-base) var(--ease-out);
}
</style>
