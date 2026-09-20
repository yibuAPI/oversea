<script setup lang="ts">
/**
 * 顶栏右上角的账号入口。控制台与公开站共用一份 —— 之前这两处的用户信息
 * 各写各的（控制台塞在左侧栏底部、公开站只有一枚「控制台」按钮），
 * 同一个人在两个页面看到的是两套不同的东西。
 *
 * 显示：头像 + 名称 + 用户 ID。ID 必须露出来 —— 提工单、找客服对账时
 * 双方都靠它定位账号，翻设置在那一层找太慢。
 *
 * 未登录时退化成「登录 / 注册」两枚按钮（site header 的旧样式），
 * 这样调用方不用自己判断登录态。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import {
  ChevronsUpDown,
  CreditCard,
  LifeBuoy,
  LogOut,
  Settings,
} from 'lucide-vue-next'
import { useUserStore } from '@/stores/user'

const user = useUserStore()
const router = useRouter()
const { t } = useI18n()

const displayName = computed(
  () => user.user?.display_name || user.user?.username || '',
)
const initial = computed(() => (displayName.value[0] || '?').toUpperCase())
/** 头像旁边那行小字。邮箱比分组更能说明「这是谁」，缺了再退回分组 */
const subline = computed(() => user.user?.email || user.user?.group || '')

const open = ref(false)
const root = ref<HTMLElement | null>(null)

// 点外面 / 按 Esc 收起。用 capture 是防某些面板 stopPropagation 掉冒泡，
// 导致点空白处关不上。
function onDocClick(e: MouseEvent) {
  if (open.value && !root.value?.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKey)
})

async function onSignOut() {
  open.value = false
  await user.logout()
  await router.replace('/')
}
</script>

<template>
  <!-- 未登录：两枚同色药丸。用 --color-accent 而不是更亮的 accent-solid：
       后者配白字只有 3.35:1，过不了 AA（与 SiteHeader 同一套取值）。 -->
  <div v-if="!user.isLoggedIn" class="flex items-center gap-3">
    <RouterLink
      to="/login"
      class="motion-press rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover"
    >
      {{ t('auth.signIn') }}
    </RouterLink>
    <RouterLink
      to="/register"
      class="motion-press hidden rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover sm:block"
    >
      {{ t('auth.signUp') }}
    </RouterLink>
  </div>

  <div v-else ref="root" class="relative">
    <button
      type="button"
      class="motion-press flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 text-left transition-colors hover:bg-bg-muted sm:pr-2"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="t('console.account.menu')"
      @click="open = !open"
    >
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-inset text-[12px] font-semibold text-fg"
        aria-hidden="true"
      >
        {{ initial }}
      </span>
      <!-- 名称 + 邮箱。窄屏只留头像（顶栏还要塞面包屑和三个图标）。
           刻意不在这里显示用户 ID：它属于「账号详情」，在账号设置里已经能看到，
           顶栏这一条再挂一遍会让整块变得啰嗦。 -->
      <span class="hidden min-w-0 sm:block">
        <span class="block max-w-[9rem] truncate text-[13px] font-medium leading-tight">
          {{ displayName }}
        </span>
        <span v-if="subline" class="block max-w-[9rem] truncate text-[11px] leading-tight text-fg-subtle">
          {{ subline }}
        </span>
      </span>
      <ChevronsUpDown class="hidden size-3.5 shrink-0 text-fg-subtle sm:block" />
    </button>

    <div
      v-if="open"
      role="menu"
      class="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
    >
      <!-- 菜单里再写一遍身份：只靠顶栏那行小字的话，展开后视线落在菜单上，
           反而不知道自己在哪个账号里操作。同样不写 ID，要看 ID 去账号设置。 -->
      <div class="border-b border-border px-3 pb-2.5 pt-2">
        <p class="truncate text-[13px] font-medium">{{ displayName }}</p>
        <p v-if="subline" class="mt-0.5 truncate text-[11.5px] text-fg-subtle">
          {{ subline }}
        </p>
      </div>
      <RouterLink
        to="/console/settings"
        role="menuitem"
        class="motion-press flex items-center gap-2.5 px-3 py-2 text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        @click="open = false"
      >
        <Settings class="size-4" />
        {{ t('console.nav.settings') }}
      </RouterLink>
      <RouterLink
        to="/console/billing"
        role="menuitem"
        class="motion-press flex items-center gap-2.5 px-3 py-2 text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        @click="open = false"
      >
        <CreditCard class="size-4" />
        {{ t('console.nav.payments') }}
      </RouterLink>
      <RouterLink
        to="/console/docs"
        role="menuitem"
        class="motion-press flex items-center gap-2.5 px-3 py-2 text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        @click="open = false"
      >
        <LifeBuoy class="size-4" />
        {{ t('console.nav.help') }}
      </RouterLink>
      <div class="my-1 h-px bg-border" />
      <button
        type="button"
        role="menuitem"
        class="motion-press flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        @click="onSignOut"
      >
        <LogOut class="size-4" />
        {{ t('auth.signOut') }}
      </button>
    </div>
  </div>
</template>
