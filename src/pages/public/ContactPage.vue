<script setup lang="ts">
/**
 * 联系我们 /about —— 后台 /api/about 富文本出口。
 *
 * 后台「关于」富文本选项（common.OptionMap["About"]）是管理员自由配置的字符串，
 * 本身可能是三种形态，按类型分别渲染：
 *   - HTTP(S) 外链   → iframe 嵌入（在线客服 / 表单页 / 知识库）
 *   - 完整 HTML      → 消毒后按富文本渲染（二维码 / 本站须知等自定义版式）
 *   - 其余           → 按 Markdown 渲染
 * 空内容时给出空态；XSS 一律通过 DOMPurify 消毒后再进 v-html。
 *
 * /about 就是后台富文本的出口（二维码 / 联系方式 / 站务通知）。
 * /company 另设为「关于我们」静态展示页（不渲染后台富文本）。
 */
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { isHttpUrl, isLikelyHtml } from '@/utils/content-format'
import { getAbout } from '@/api/auth'
import RichContent from '@/components/common/RichContent.vue'

const { t } = useI18n()

const aboutQ = useQuery({ queryKey: ['about-content'], queryFn: getAbout })

const rawContent = computed(() => aboutQ.data.value?.trim() ?? '')
const hasContent = computed(() => rawContent.value.length > 0)
const isUrl = computed(() => hasContent.value && isHttpUrl(rawContent.value))
const contentIsHtml = computed(() => hasContent.value && isLikelyHtml(rawContent.value))
</script>

<template>
  <div class="mx-auto max-w-[1100px] px-6 pb-24 pt-[140px] lg:pt-[168px]">
    <p class="text-[18px] font-semibold leading-[21.6px] text-brand">
      {{ t('public.contact.eyebrow') }}
    </p>
    <h1
      class="mt-4 max-w-[720px] text-[32px] font-semibold leading-[1.1] tracking-[-0.84px] lg:text-[42px]"
    >
      {{ t('public.contact.title') }}
    </h1>

    <!-- 加载骨架 -->
    <div v-if="aboutQ.isLoading.value" class="mt-10 space-y-3">
      <div class="h-4 w-3/4 animate-pulse rounded bg-bg-muted" />
      <div class="h-4 w-1/2 animate-pulse rounded bg-bg-muted" />
      <div class="h-32 w-full animate-pulse rounded-xl border border-border bg-bg-elevated" />
    </div>

    <!-- 加载失败 -->
    <div
      v-else-if="aboutQ.error.value"
      class="mt-10 rounded-[16px] border border-border bg-bg-elevated px-4 py-14 text-center"
    >
      <p class="text-[14px] text-fg-muted">{{ t('public.contact.error') }}</p>
      <button
        type="button"
        class="mt-4 rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
        @click="aboutQ.refetch()"
      >
        {{ t('common.retry') }}
      </button>
    </div>

    <!-- 空内容 -->
    <div
      v-else-if="!hasContent"
      class="mt-10 rounded-[16px] border border-dashed border-border bg-bg-elevated px-4 py-14 text-center"
    >
      <p class="text-[15px] font-medium text-fg">{{ t('public.contact.emptyTitle') }}</p>
      <p class="mx-auto mt-2 max-w-[480px] text-[13.5px] leading-[1.7] text-fg-muted">
        {{ t('public.contact.emptyDesc') }}
      </p>
    </div>

    <!-- 外链 → iframe -->
    <iframe
      v-else-if="isUrl"
      :src="rawContent"
      class="mt-10 h-[720px] w-full rounded-[16px] border border-border bg-bg-elevated"
      :title="t('public.contact.title')"
      loading="lazy"
    />

    <!-- HTML / Markdown → 富文本 -->
    <div v-else class="mt-10">
      <RichContent
        :mode="contentIsHtml ? 'html' : 'markdown'"
        :content="rawContent"
        class="max-w-none"
      />
    </div>
  </div>
</template>
