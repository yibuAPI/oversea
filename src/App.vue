<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import { useThemeStore } from '@/stores/theme'
import { storeToRefs } from 'pinia'
import SupportWidget from '@/components/support/SupportWidget.vue'

const theme = useThemeStore()
const { isDark } = storeToRefs(theme)
</script>

<template>
  <RouterView />
  <!-- 全站悬浮客服。自身按 /api/status 的 live_support_enabled 决定是否渲染 -->
  <SupportWidget />
  <Toaster
    position="top-center"
    :theme="isDark ? 'dark' : 'light'"
    rich-colors
  />
</template>
