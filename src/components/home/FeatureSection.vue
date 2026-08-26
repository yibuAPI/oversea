<script setup lang="ts">
/**
 * 交替特性区块 —— infron.ai y1802 白色长条，CDP 实测：
 *
 *   section   padding 64px 20px 80px，背景纯白
 *   每段      标题 42px/600 lh 50.4px ls -0.84px
 *             要点 16px/500 lh 22.4px #38383D，行距 42px
 *             "Learn more" 16px/500 ls -0.16px
 *   视觉块    494×494，radius 24px；左右交替（第 2、4 段视觉在左）
 *   段节奏    实测 y1914 / 2516 / 3106 / 3696，约 590px 一段
 *
 * 视觉块用具名 slot 暴露：有真实产品截图就放，没有就是干净的留白，
 * 不拿装饰图假装成产品界面。
 */
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'
import FeatureVisual from './FeatureVisual.vue'

const { t, tm } = useI18n()

const blocks = [
  { key: 'unified', to: '/docs', visual: 'code' },
  { key: 'reliability', to: '/company', visual: 'failover' },
  { key: 'support', to: '/about', visual: 'support' },
] as const

/** 每段 3 条要点，从 i18n 数组取；缺失时该段只渲染标题 */
function points(key: string): string[] {
  const v = tm(`home.features.${key}.points`)
  return Array.isArray(v) ? (v as unknown as string[]) : []
}
</script>

<template>
  <section class="bg-bg-elevated px-5 pb-20 pt-16">
    <!--
      容器 1100 而非 1256：1878px 实测 infron，页面主体容器是
      「1100 居中」（出现 22 次），1256 只是 hero 那一层的宽度。
      这里用 1256 会让四段特性比上下相邻区块各宽出 78px，
      滚动时边界左右晃动 —— 正是「对不齐」的来源。
    -->
    <div class="mx-auto max-w-[1100px]">
      <div
        v-for="(b, i) in blocks"
        :key="b.key"
        class="grid items-center gap-10 py-14 lg:grid-cols-2 lg:gap-24 lg:py-12"
      >
        <!-- 偶数段视觉在左：用 order 翻转，DOM 顺序保持「文案先读」 -->
        <div :class="i % 2 === 1 ? 'lg:order-2' : ''">
          <h2
            class="text-[32px] font-semibold leading-[1.1] tracking-[-0.84px] lg:text-[42px] lg:leading-[50.4px]"
          >
            {{ t(`home.features.${b.key}.title`) }}
          </h2>

          <ul class="mt-8 space-y-5">
            <li
              v-for="p in points(b.key)"
              :key="p"
              class="flex gap-3 text-[16px] font-medium leading-[22.4px] text-fg-secondary"
            >
              <span
                class="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand"
                aria-hidden="true"
              />
              <span>{{ p }}</span>
            </li>
          </ul>

          <RouterLink
            :to="b.to"
            class="group mt-9 inline-flex items-center gap-1.5 text-[16px] font-medium tracking-[-0.16px] transition-opacity hover:opacity-70"
          >
            {{ t('home.features.learnMore') }}
            <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
          </RouterLink>
        </div>

        <div
          class="aspect-square w-full max-w-[494px] lg:justify-self-center"
          :class="i % 2 === 1 ? 'lg:order-1' : ''"
        >
          <FeatureVisual :kind="b.visual" />
        </div>
      </div>
    </div>
  </section>
</template>
