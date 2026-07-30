<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
</script>

<template>
  <div class="grid min-h-dvh place-items-center bg-bg px-6 text-center">
    <div>
      <p class="text-brand-gradient text-7xl font-bold tracking-tight">404</p>
      <h1 class="mt-4 text-xl font-semibold">{{ t('error.notFound') }}</h1>
      <RouterLink
        to="/"
        class="mt-7 inline-flex h-10 items-center rounded-md bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      >
        {{ t('common.back') }}
      </RouterLink>
    </div>
  </div>
</template>
