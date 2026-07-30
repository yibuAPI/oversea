<script setup lang="ts">
/**
 * FAQ —— infron.ai y7068 区块，CDP 实测：
 *
 *   section  padding 20px，高 600，背景纯白
 *   左栏     眉标 "FAQ" 18px/600 #3F3AD4；标题 42px/600 lh 50.4px ls -0.84px，宽 400
 *   右栏     行 x596 w652 h64，radius 10px，背景 #F8FAFC，行距 12px（实测 7242→7318）
 *   问       16px/400 lh16 ls -0.16px 纯黑
 *   答       16px/400 lh 20.8px ls -0.16px #666
 *
 * 仍用原生 details/summary：键盘操作和读屏器开箱即用，
 * 自己实现手风琴容易把无障碍做丢。
 */
import { useI18n } from 'vue-i18n'
import { Plus } from 'lucide-vue-next'

const { t } = useI18n()
const items = ['models', 'billing', 'compat', 'limits', 'support'] as const
</script>

<template>
  <section class="bg-bg-elevated px-5 py-[100px]">
    <div class="mx-auto grid max-w-[1100px] gap-10 lg:grid-cols-[400px_minmax(0,652px)] lg:gap-12">
      <div>
        <p class="text-[18px] font-semibold leading-[21.6px] text-brand">
          {{ t('home.faq.eyebrow') }}
        </p>
        <h2
          class="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.84px] lg:text-[42px] lg:leading-[50.4px]"
        >
          {{ t('home.faq.title') }}
        </h2>
      </div>

      <div class="space-y-3">
        <details
          v-for="key in items"
          :key="key"
          class="group rounded-[10px] bg-bg-muted px-6"
        >
          <summary
            class="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-normal leading-4 tracking-[-0.16px] marker:hidden"
          >
            {{ t(`home.faq.${key}.q`) }}
            <Plus
              class="size-4 shrink-0 text-fg-subtle transition-transform duration-200 group-open:rotate-45"
            />
          </summary>
          <p
            class="pb-6 text-[16px] leading-[20.8px] tracking-[-0.16px] text-fg-muted"
          >
            {{ t(`home.faq.${key}.a`) }}
          </p>
        </details>
      </div>
    </div>
  </section>
</template>
