<script setup lang="ts">
/**
 * 控制台外壳：左侧栏常驻 + 顶栏（面包屑 / 主题切换）+ 内容区。
 *
 * lg 以下左侧栏收成抽屉。抽屉打开时锁 body 滚动，
 * 并在路由跳转后自动关闭（靠 sidebar 的 navigate 事件）。
 */
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Menu, X, Sun, Moon, Languages } from 'lucide-vue-next'
import ConsoleSidebar from '@/components/console/ConsoleSidebar.vue'
import { useThemeStore } from '@/stores/theme'
import { setLocale } from '@/i18n'

const route = useRoute()
const { t, locale } = useI18n()
const theme = useThemeStore()

function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}

const drawerOpen = ref(false)

/** 面包屑取当前路由 meta.title，回落到「控制台」 */
const pageTitle = computed(() => {
  const key = route.meta.titleKey
  return typeof key === 'string' ? t(key) : t('nav.console')
})

watch(drawerOpen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})
</script>

<template>
  <div class="min-h-dvh bg-bg">
    <!-- 桌面侧栏 -->
    <div class="fixed inset-y-0 left-0 z-30 hidden lg:block">
      <ConsoleSidebar />
    </div>

    <!-- 移动端抽屉 -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="drawerOpen"
        class="fixed inset-0 z-40 bg-black/40 lg:hidden"
        @click="drawerOpen = false"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-200 ease-out"
      leave-active-class="transition-transform duration-200 ease-out"
      enter-from-class="-translate-x-full"
      leave-to-class="-translate-x-full"
    >
      <div v-if="drawerOpen" class="fixed inset-y-0 left-0 z-50 lg:hidden">
        <ConsoleSidebar @navigate="drawerOpen = false" />
        <button
          type="button"
          class="absolute -right-11 top-3 flex size-9 items-center justify-center rounded-lg bg-bg-elevated text-fg-muted shadow-md"
          :aria-label="t('common.close')"
          @click="drawerOpen = false"
        >
          <X class="size-4.5" />
        </button>
      </div>
    </Transition>

    <div class="lg:pl-64">
      <!-- 顶栏 -->
      <header
        class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md sm:px-6"
      >
        <button
          type="button"
          class="motion-press -ml-1 flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-muted hover:text-fg lg:hidden"
          :aria-label="t('nav.menu')"
          @click="drawerOpen = true"
        >
          <Menu class="size-4.5" />
        </button>

        <nav aria-label="Breadcrumb" class="min-w-0">
          <ol class="flex items-center gap-2 text-[13.5px]">
            <li class="hidden text-fg-subtle sm:block">{{ t('nav.console') }}</li>
            <li class="hidden text-fg-subtle sm:block" aria-hidden="true">/</li>
            <li class="truncate font-medium">{{ pageTitle }}</li>
          </ol>
        </nav>

        <button
          type="button"
          class="motion-press ml-auto flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-muted hover:text-fg"
          aria-label="Switch language"
          @click="toggleLocale"
        >
          <Languages class="size-4.5" />
        </button>
        <button
          type="button"
          class="motion-press flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-bg-muted hover:text-fg"
          :aria-label="t('theme.toggle')"
          @click="theme.toggle()"
        >
          <Sun v-if="theme.isDark" class="size-4.5" />
          <Moon v-else class="size-4.5" />
        </button>
      </header>

      <main class="px-4 py-6 sm:px-6 lg:px-8">
        <div class="mx-auto max-w-[1100px]">
          <RouterView />
        </div>
      </main>
    </div>
  </div>
</template>
