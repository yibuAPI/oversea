<script setup lang="ts">
/**
 * 公开区页面外壳：悬浮导航 + 深色页脚。
 * main 不设容器 —— 模型页/关于页需要全宽的深色或渐变 hero（infron 版式），
 * 定宽与顶部留白（吃掉 fixed 导航的高度）由各页面自己控制。
 */
import { RouterView } from 'vue-router'
import SiteHeader from '@/components/layout/SiteHeader.vue'
import SiteFooter from '@/components/layout/SiteFooter.vue'
</script>

<template>
  <div class="relative flex min-h-dvh flex-col bg-bg text-fg">
    <SiteHeader />

    <main class="flex-1">
      <RouterView />
    </main>

    <SiteFooter />
  </div>
</template>
