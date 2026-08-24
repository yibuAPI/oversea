<script setup lang="ts">
/**
 * 页脚 —— infron.ai y8122 区块，CDP 实测：
 *
 *   区块    高 451，深色底；内容 x148 w1100，列间距 40px
 *   左栏    状态行 / 邮箱 / 地址，14px/400 lh 18.2px ls -0.14px，白 85%
 *   四列    列标题 14px/400 lh14 ls -0.14px #919191 全大写
 *           链接 16px/400 lh16 ls -0.16px 白 85%，行距 32px
 *
 * 之前做成浅色页脚是我自己的发挥；实测是深色收尾，
 * 和上方浅色 CTA 形成对比 —— 这是整页的节奏收口。
 * 站名与 logo 走 site store，运行时可由后台改动。
 */
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useSiteStore } from '@/stores/site'

const site = useSiteStore()
const { systemName, logo, status } = storeToRefs(site)
const { t } = useI18n()

/** 后端 VERSION 文件为空时会下发 v0.0.0；此处统一去掉前导 v 再展示，避免出现 vv */
const version = computed(() => {
  const raw = status.value?.version
  if (!raw) return null
  return raw.replace(/^v/i, '')
})

const columns = [
  { key: 'product', links: ['models', 'pricing', 'rankings'] },
  { key: 'developers', links: ['docs', 'quickstart', 'console', 'contact'] },
] as const

const hrefs: Record<string, string> = {
  models: '/models',
  pricing: '/pricing',
  rankings: '/rankings',
  docs: '/docs',
  quickstart: '/docs',
  console: '/console',
  contact: '/about',
}
</script>

<template>
  <footer class="bg-black text-white">
    <div class="mx-auto max-w-[1100px] px-6 py-[100px]">
      <div class="grid gap-10 lg:grid-cols-[1fr_repeat(2,auto)] lg:gap-10">
        <div>
          <RouterLink to="/" class="flex items-center gap-2.5">
            <img :src="logo" :alt="systemName" class="h-5 w-auto" />
            <span class="text-[17px] font-semibold tracking-tight">
              {{ systemName }}
            </span>
          </RouterLink>

          <p
            class="mt-8 inline-flex items-center gap-2 text-[14px] leading-[18.2px] tracking-[-0.14px] text-white/85"
          >
            <span class="size-1.5 rounded-full bg-success-fg" aria-hidden="true" />
            {{ t('home.footer.operational') }}
          </p>

          <p
            class="mt-2.5 max-w-[280px] text-[14px] leading-[18.2px] tracking-[-0.14px] text-white/85"
          >
            {{ t('home.footer.tagline') }}
          </p>
        </div>

        <div v-for="col in columns" :key="col.key" class="lg:min-w-[140px]">
          <h3
            class="text-[14px] font-normal uppercase leading-[14px] tracking-[-0.14px] text-[#919191]"
          >
            {{ t(`home.footer.${col.key}`) }}
          </h3>
          <ul class="mt-4 space-y-4">
            <li v-for="l in col.links" :key="l">
              <RouterLink
                :to="hrefs[l] || '/'"
                class="text-[16px] font-normal leading-4 tracking-[-0.16px] text-white/85 transition-colors hover:text-white"
              >
                {{ t(`home.footer.link.${l}`) }}
              </RouterLink>
            </li>
          </ul>
        </div>
      </div>

      <div
        class="mt-16 flex flex-col gap-3 border-t border-white/15 pt-8 text-[14px] leading-[18.2px] tracking-[-0.14px] text-white/85 sm:flex-row sm:items-center sm:justify-between"
      >
        <p>© {{ new Date().getFullYear() }} {{ systemName }}</p>
        <span v-if="version" class="font-mono text-xs text-white/60">
          v{{ version }}
        </span>
      </div>
    </div>
  </footer>
</template>
