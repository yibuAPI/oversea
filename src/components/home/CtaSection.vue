<script setup lang="ts">
/**
 * 收尾 CTA —— infron.ai y7668 区块，CDP 实测：
 *
 *   区块    高 454，内容 x148 w1100，左对齐（不是居中）
 *   标题    48px/400 lh 52.8px，色 rgba(0,0,0,.45)，宽 855
 *           —— 前半句浅灰、后半句纯黑的双色标题，是这块的记忆点
 *   正文    16px/400 lh 22.4px #38383D，宽 950
 *   按钮    高 40px，14px/400 ls -0.14px；主按钮黑底白字
 *   容器    y7768 w1100 h254 radius 12px
 *
 * 之前做成"深色圆角面板 + 居中大字"是我自己的发挥，
 * 实测是浅色左对齐的大字块，观感完全不同。
 */
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'

const { t } = useI18n()
</script>

<template>
  <section class="px-5 pb-[100px] pt-[60px]">
    <div class="mx-auto max-w-[1100px] rounded-[12px] pt-2.5">
      <!-- 双色标题：弱化的引子 + 高对比的主张 -->
      <h2
        class="max-w-[855px] text-[32px] font-normal leading-[1.1] text-fg/45 lg:text-[48px] lg:leading-[52.8px]"
      >
        {{ t('home.cta.titleMuted') }}
        <span class="text-fg">{{ t('home.cta.titleStrong') }}</span>
      </h2>

      <p class="mt-8 max-w-[950px] text-[16px] leading-[22.4px] text-fg-secondary">
        {{ t('home.cta.subtitle') }}
      </p>

      <div class="mt-10 flex flex-wrap items-center gap-3">
        <RouterLink
          to="/console"
          class="group inline-flex h-10 items-center gap-2.5 rounded-[20px] bg-btn-primary-bg py-2 pl-[18px] pr-2 text-[14px] font-normal tracking-[-0.14px] text-btn-primary-fg transition-opacity hover:opacity-88"
        >
          {{ t('home.cta.primary') }}
          <span
            class="grid size-6 shrink-0 place-items-center rounded-full bg-btn-primary-fg/15 transition-transform group-hover:translate-x-0.5"
          >
            <ArrowRight class="size-3.5" />
          </span>
        </RouterLink>

        <RouterLink
          to="/pricing"
          class="inline-flex h-10 items-center rounded-[100px] border border-border-strong px-[18px] text-[14px] font-normal tracking-[-0.14px] transition-colors hover:bg-bg-muted"
        >
          {{ t('home.cta.secondary') }}
        </RouterLink>
      </div>
    </div>
  </section>
</template>
