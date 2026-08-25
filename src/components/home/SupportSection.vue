<script setup lang="ts">
/**
 * 专家支持区块 —— infron.ai y4318，CDP 实测：
 *
 *   section  padding 100px 20px 120px
 *   左栏     标题 42px/600 lh 46.2px ls -0.84px，宽 514
 *            正文 16px/400 lh 22.4px #38383D
 *   右栏     卡片 x758 w466，radius 24px，padding 24px，白底，卡间距 24px
 *            卡标题 20px/600 lh24；卡正文 16px/400 lh 22.4px #38383D
 *   外框     x734 w514 radius 20px padding 24px
 */
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'

const { t, tm } = useI18n()

const cards = ['response', 'founder', 'roadmap'] as const

function bullets(): string[] {
  const v = tm('home.support.points')
  return Array.isArray(v) ? (v as unknown as string[]) : []
}
</script>

<template>
  <section class="px-5 pb-[120px] pt-[100px]">
    <div class="mx-auto grid max-w-[1100px] gap-12 lg:grid-cols-2 lg:gap-16">
      <div>
        <h2
          class="max-w-[514px] text-[32px] font-semibold leading-[1.1] tracking-[-0.84px] lg:text-[42px] lg:leading-[46.2px]"
        >
          {{ t('home.support.title') }}
        </h2>

        <p class="mt-8 max-w-[514px] text-[16px] leading-[22.4px] text-fg-secondary">
          {{ t('home.support.desc') }}
        </p>

        <ul class="mt-8 space-y-3">
          <li
            v-for="b in bullets()"
            :key="b"
            class="flex gap-3 text-[16px] font-medium leading-[22.4px] text-fg-secondary"
          >
            <span class="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <span>{{ b }}</span>
          </li>
        </ul>

        <RouterLink
          to="/about"
          class="group mt-10 inline-flex items-center gap-1.5 text-[16px] font-medium tracking-[-0.16px] transition-opacity hover:opacity-70"
        >
          {{ t('home.support.cta') }}
          <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
        </RouterLink>
      </div>

      <!-- 右侧卡片组：实测外框 radius 20 + 内卡 radius 24 的双层结构 -->
      <div class="space-y-6 rounded-[20px] bg-bg-subtle p-6">
        <article
          v-for="c in cards"
          :key="c"
          class="motion-lift rounded-[24px] bg-bg-elevated p-6 hover:shadow-lg"
        >
          <h3 class="text-[20px] font-semibold leading-6">
            {{ t(`home.support.card.${c}.title`) }}
          </h3>
          <p class="mt-4 text-[16px] leading-[22.4px] text-fg-secondary">
            {{ t(`home.support.card.${c}.desc`) }}
          </p>
        </article>
      </div>
    </div>
  </section>
</template>
