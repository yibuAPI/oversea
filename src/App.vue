<script setup lang="ts">
import { Toaster } from 'vue-sonner'
import { useThemeStore } from '@/stores/theme'
import { storeToRefs } from 'pinia'

const theme = useThemeStore()
const { isDark } = storeToRefs(theme)
</script>

<template>
  <RouterView />
  <Toaster
    position="top-center"
    :theme="isDark ? 'dark' : 'light'"
    rich-colors
  />
</template>
