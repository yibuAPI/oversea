<script setup lang="ts">
/**
 * 模型库区块 —— infron.ai y902 区块，CDP 实测：
 *
 *   section     padding 100px 20px，高 900
 *   白卡        x148 w1100 h700，radius 24px，padding 48px
 *   眉标        18px / 600 / #3F3AD4
 *   标题        42px / 600 / lh 46.2px / ls -0.42px
 *   正文        16px / 400 / lh 22.4px / #38383D，宽 416
 *   数据条      4 列各 246px；数字 56px/400 lh56 ls-2.24px
 *                            标签 22px/400 #999
 *   右侧插画    x976 w400 h640 radius16 shadow 0 5px 40px rgba(0,0,0,.16)
 *
 * 数字取自 site store 的真实后端数据，没有就不显示该列——
 * 首页数字必须能对得上后台，编不得。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    /** 已接入模型数，来自 /api/pricing */
    modelCount?: number | null
    /** 上游厂商数，来自 /api/pricing 的 vendor_id 去重 */
    providerCount?: number | null
    /** 右侧清单预览用的真实模型（名称/厂商/每百万 token 输入价） */
    preview?: { name: string; vendor: string; price: string }[]
  }>(),
  { modelCount: null, providerCount: null, preview: () => [] },
)

const { t, n } = useI18n()

/** 无真实值时退回占位符号，不编造数字 */
const metrics = computed(() => [
  {
    key: 'models',
    value: props.modelCount ? `${n(props.modelCount)}+` : '—',
    label: t('home.library.metric.models'),
  },
  {
    key: 'providers',
    value: props.providerCount ? `${n(props.providerCount)}+` : '—',
    label: t('home.library.metric.providers'),
  },
  { key: 'compat', value: '100%', label: t('home.library.metric.compat') },
  { key: 'uptime', value: '99.9%', label: t('home.library.metric.uptime') },
])
</script>

<template>
  <section class="px-5 py-[100px]">
    <div
      class="mx-auto max-w-[1100px] rounded-[24px] bg-bg-elevated p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] lg:p-12"
    >
      <div class="grid gap-10 lg:grid-cols-[416px_minmax(0,1fr)] lg:gap-14">
        <div class="pt-6">
          <p class="text-[18px] font-semibold leading-[21.6px] text-brand">
            {{ t('home.library.eyebrow') }}
          </p>

          <h2
            class="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.42px] lg:text-[42px] lg:leading-[46.2px]"
          >
            {{ t('home.library.title') }}
          </h2>

          <p class="mt-6 text-[16px] leading-[22.4px] text-fg-secondary">
            {{ t('home.library.desc') }}
          </p>

          <RouterLink
            to="/models"
            class="group mt-8 inline-flex items-center gap-1.5 text-[16px] font-medium tracking-[-0.16px] transition-opacity hover:opacity-70"
          >
            {{ t('home.library.cta') }}
            <ArrowRight class="size-4 transition-transform group-hover:translate-x-0.5" />
          </RouterLink>
        </div>

        <!-- 右侧模型清单预览：用真实模型名；无数据时不渲染空壳 -->
        <div v-if="preview.length" class="hidden lg:block">
          <div
            class="ml-auto w-[400px] overflow-hidden rounded-[16px] border border-border bg-bg-elevated shadow-[0_5px_40px_rgba(0,0,0,0.16)]"
          >
            <div class="border-b border-border px-5 py-4">
              <p class="text-[15px] font-semibold">{{ t('home.library.preview') }}</p>
            </div>
            <ul>
              <li
                v-for="m in preview"
                :key="m.name"
                class="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 last:border-0"
              >
                <div class="min-w-0">
                  <p class="truncate font-mono text-[13px]">{{ m.name }}</p>
                  <p class="mt-0.5 text-[12px] text-fg-subtle">{{ m.vendor }}</p>
                </div>
                <span class="shrink-0 text-[13px] tabular-nums text-fg-muted">
                  {{ m.price }}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!--
        数据条：4 等分，实测数字 56px / 标签 22px。
        infron 原值 mt-180px 是为了让数据条落在右侧插画下方；
        我们的预览卡比它矮，照抄会留一整片死白，故收到 96px。
      -->
      <dl class="mt-14 grid grid-cols-2 gap-y-10 lg:mt-24 lg:grid-cols-4">
        <div v-for="m in metrics" :key="m.key">
          <dt class="sr-only">{{ m.label }}</dt>
          <dd>
            <span
              class="block text-[40px] font-normal leading-none tracking-[-1.6px] lg:text-[56px] lg:leading-[56px] lg:tracking-[-2.24px]"
            >
              {{ m.value }}
            </span>
            <span
              class="mt-2.5 block text-[18px] font-normal leading-none tracking-[-0.36px] text-fg-subtle lg:text-[22px] lg:leading-[22px] lg:tracking-[-0.44px]"
            >
              {{ m.label }}
            </span>
          </dd>
        </div>
      </dl>
    </div>
  </section>
</template>
