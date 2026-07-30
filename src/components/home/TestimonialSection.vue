<script setup lang="ts">
/**
 * 证言区块 —— infron.ai y5148，CDP 实测：
 *
 *   section  高 700，纯黑底，padding 100px 100px 84px
 *   卡片     宽 1080，横向轮播（实测 x158 居中、左右各一张在视口外）
 *   引语     32px/600 lh 38.4px 白色
 *   姓名     16px/600 白色；职衔 16px/400 白色
 *
 * quotes 为空时整块不渲染 —— 客户证言必须是真实的，
 * 编一段"某某 CEO 说我们很好"是欺诈，不是设计。
 */
import { useI18n } from 'vue-i18n'

export interface Quote {
  /** 证言正文 */
  text: string
  /** 证言人姓名 */
  author: string
  /** 职衔与公司 */
  role: string
}

withDefaults(defineProps<{ quotes?: Quote[] }>(), { quotes: () => [] })

const { t } = useI18n()
</script>

<template>
  <section
    v-if="quotes.length"
    class="bg-black px-6 pb-[84px] pt-[100px] text-white lg:px-[100px]"
    :aria-label="t('home.testimonials.label')"
  >
    <ul class="flex snap-x snap-mandatory gap-16 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <li
        v-for="q in quotes"
        :key="q.author"
        class="w-full max-w-[1080px] shrink-0 snap-center"
      >
        <figure>
          <blockquote
            class="text-[24px] font-semibold leading-[1.2] lg:text-[32px] lg:leading-[38.4px]"
          >
            {{ q.text }}
          </blockquote>
          <figcaption class="mt-12 text-[16px] leading-[22.4px]">
            <span class="block font-semibold">{{ q.author }}</span>
            <span class="block font-normal text-white/80">{{ q.role }}</span>
          </figcaption>
        </figure>
      </li>
    </ul>
  </section>
</template>
