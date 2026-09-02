<script setup lang="ts">
/**
 * 密钥集成。infron 此页叫 Keys Integrations，是 BYOK（自带上游密钥）。
 *
 * 后端能力差异（如实在此说明）：
 *   上游渠道密钥是站点级配置（管理员在 channel 管理页配），
 *   没有任何用户端「自带上游密钥」接口 —— 我们不画假的 BYOK 表单。
 *   此页聚焦**用户端真正可操作的集成**：
 *
 *   1. 系统访问令牌  GET /user/token 生成/重置 access_token，
 *      配套 /api/status 的 chat_link 直接跳聊天面板使用。
 *      ⚠️ 生成会**覆盖旧值**（旧 token 立即失效），UI 必须二次确认。
 *   2. OpenAI 兼容接入  即拿 API Key + base_url 配到下游客户端，
 *      主流客户端（LobeChat / Cherry / NextChat 等）的字段都是一样的，
 *      照抄文档页的真实 base_url，不写死域名。
 *
 * API 密钥本身的管理在 /console/keys，这里只做入口，不重复实现。
 */
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useMutation } from '@tanstack/vue-query'
import { RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import { ArrowUpRight, Check, Copy, KeyRound, RotateCcw, TriangleAlert } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { regenerateAccessToken } from '@/api/account'
import { DOCS_BASE_URL } from '@/utils/content-format'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import PageHeader from '@/components/ui/PageHeader.vue'

const site = useSiteStore()
const { status } = storeToRefs(site)
const { t } = useI18n()

/** base_url 固定用 DOCS_BASE_URL，与文档页口径一致（不随后端 server_address 变化） */
const baseUrl = DOCS_BASE_URL

/** chat_link 是后端站点配置，格式模板含 {key} 占位 */
const chatLinkTemplate = computed(() =>
  typeof status.value?.chat_link === 'string' ? status.value.chat_link : '',
)

/** 客户端列表：都是 OpenAI 兼容协议下最常被问到的下游，名称不做营销展开 */
const CLIENTS = [
  { key: 'lobechat', label: 'LobeChat' },
  { key: 'cherrystudio', label: 'Cherry Studio' },
  { key: 'nextchat', label: 'NextChat' },
  { key: 'openwebui', label: 'Open WebUI' },
  { key: 'immersive', label: 'Immersive Translate' },
  { key: 'langchain', label: 'LangChain / LlamaIndex' },
] as const

const activeClient = ref<(typeof CLIENTS)[number]['key']>('lobechat')

// ───────────────── 访问令牌 ─────────────────

const confirmOpen = ref(false)
const generatedToken = ref<string | null>(null)

const genMut = useMutation({
  mutationFn: regenerateAccessToken,
  onSuccess: (token) => {
    generatedToken.value = token ?? null
    confirmOpen.value = false
    toast.success(t('integrations.tokenGenerated'))
  },
  onError: (e: Error) => toast.error(e.message),
})

/** chat_link 里的 {key} 替换成真实 token；没有 token 或模板时整块入口不出现 */
const chatLink = computed(() => {
  if (!generatedToken.value || !chatLinkTemplate.value) return ''
  if (chatLinkTemplate.value.includes('{key}')) {
    return chatLinkTemplate.value.replace('{key}', generatedToken.value)
  }
  return chatLinkTemplate.value
})

const copied = ref<string | null>(null)
async function copyText(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = id
    setTimeout(() => (copied.value = null), 1500)
  } catch {
    toast.error(t('keys.copyFailed'))
  }
}

/** 按客户端渲染配置参数 —— 字段完全一致，只是壳不同 */
const clientFields = computed(() => [
  { label: t('integrations.fieldUrl'), value: `${baseUrl}/v1`, id: 'url' },
  {
    label: t('integrations.fieldKey'),
    value: t('integrations.fieldKeyPlaceholder'),
    id: 'key',
    isKeyHint: true,
  },
])
</script>

<template>
  <div>
    <PageHeader :title="t('integrations.title')" :description="t('integrations.subtitle')" />

    <!-- 能力差异说明：BYOK 属管理员配置，用户端没有该入口，不画假表单 -->
    <div
      class="mb-6 rounded-xl border border-border bg-bg-subtle px-4 py-3 text-[12.5px] leading-relaxed text-fg-muted"
    >
      {{ t('integrations.byokNotice') }}
    </div>

    <!-- 访问令牌 + 聊天面板 -->
    <section class="mb-8 rounded-xl border border-border bg-bg-elevated p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="text-[15px] font-semibold tracking-tight">
            {{ t('integrations.accessTitle') }}
          </h2>
          <p class="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
            {{ t('integrations.accessDesc') }}
          </p>
        </div>
        <AppButton
          variant="primary"
          :loading="genMut.isPending.value"
          @click="confirmOpen = true"
        >
          <RotateCcw class="size-3.5" />
          {{
            generatedToken
              ? t('integrations.regenerate')
              : t('integrations.generate')
          }}
        </AppButton>
      </div>

      <!-- 生成成功后：令牌只显示一次，不持久化 -->
      <div v-if="generatedToken" class="mt-4 space-y-3">
        <div>
          <p class="mb-1.5 text-[11.5px] uppercase tracking-wide text-fg-subtle">
            {{ t('integrations.accessTokenLabel') }}
          </p>
          <div class="flex items-center gap-2">
            <code
              class="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg-subtle px-3 py-2 font-mono text-[12px]"
            >
              {{ generatedToken }}
            </code>
            <button
              type="button"
              class="shrink-0 rounded-lg border border-border p-2 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              :aria-label="t('common.copy')"
              @click="copyText(generatedToken!, 'token')"
            >
              <Check v-if="copied === 'token'" class="size-4 text-success-fg" />
              <Copy v-else class="size-4" />
            </button>
          </div>
          <p class="mt-1.5 text-[11.5px] text-fg-subtle">
            {{ t('integrations.tokenShownOnce') }}
          </p>
        </div>

        <a
          v-if="chatLink"
          :href="chatLink"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-btn-primary-bg px-3.5 text-[13px] font-medium text-btn-primary-fg transition-colors hover:bg-btn-primary-hover"
        >
          {{ t('integrations.openChat') }}
          <ArrowUpRight class="size-3.5" />
        </a>
      </div>
    </section>

    <!-- OpenAI 兼容接入 -->
    <section class="mb-8">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-[15px] font-semibold tracking-tight">
            {{ t('integrations.clientsTitle') }}
          </h2>
          <p class="mt-1 text-[12.5px] text-fg-muted">
            {{ t('integrations.clientsDesc') }}
          </p>
        </div>
        <RouterLink
          to="/console/keys"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
        >
          <KeyRound class="size-3.5" />
          {{ t('integrations.manageKeys') }}
        </RouterLink>
      </div>

      <!-- 客户端切换：同一套字段，只是不同下游 -->
      <div class="mb-4 flex flex-wrap gap-1.5">
        <button
          v-for="c in CLIENTS"
          :key="c.key"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[12px] transition-colors"
          :class="
            activeClient === c.key
              ? 'border-border-selected bg-accent-bg text-accent'
              : 'border-border text-fg-muted hover:bg-bg-muted hover:text-fg'
          "
          :aria-pressed="activeClient === c.key"
          @click="activeClient = c.key"
        >
          {{ c.label }}
        </button>
      </div>

      <div class="overflow-hidden rounded-xl border border-border bg-bg-elevated">
        <div
          class="border-b border-border bg-bg-subtle px-4 py-2.5 text-[12.5px] font-medium"
        >
          {{ CLIENTS.find((c) => c.key === activeClient)?.label }}
        </div>

        <div class="divide-y divide-border">
          <div
            v-for="f in clientFields"
            :key="f.id"
            class="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <p class="w-[110px] shrink-0 text-[12px] text-fg-subtle">{{ f.label }}</p>
            <div class="flex min-w-0 flex-1 items-center gap-2">
              <template v-if="!f.isKeyHint">
                <code class="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                  {{ f.value }}
                </code>
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-border p-1.5 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
                  :aria-label="t('common.copy')"
                  @click="copyText(f.value, f.id)"
                >
                  <Check v-if="copied === f.id" class="size-3.5 text-success-fg" />
                  <Copy v-else class="size-3.5" />
                </button>
              </template>
              <template v-else>
                <p class="min-w-0 flex-1 text-[12.5px] text-fg-muted">{{ f.value }}</p>
                <RouterLink
                  to="/console/keys"
                  class="shrink-0 text-[12px] font-medium text-accent hover:underline"
                >
                  {{ t('integrations.getKey') }}
                </RouterLink>
              </template>
            </div>
          </div>

          <!-- 每客户端的接入步骤，仅做字段映射说明，不复述第三方文档 -->
          <div class="px-4 py-3 text-[12px] leading-relaxed text-fg-muted">
            {{ t(`integrations.step_${activeClient}`) }}
          </div>
        </div>
      </div>

      <p class="mt-3 text-[11.5px] text-fg-subtle">
        {{ t('integrations.clientsNote') }}
      </p>
    </section>

    <!-- 覆盖旧 token 的二次确认：这是破坏性操作，必须说清后果 -->
    <AppModal
      :open="confirmOpen"
      :title="t('integrations.regenerateTitle')"
      :description="t('integrations.regenerateDesc')"
      @close="confirmOpen = false"
    >
      <div
        class="flex gap-2.5 rounded-lg border border-warning-border bg-warning-bg p-3 text-[12.5px] text-warning-fg"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0" />
        <p>{{ t('integrations.regenerateWarning') }}</p>
      </div>
      <template #footer>
        <AppButton variant="ghost" @click="confirmOpen = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          variant="primary"
          :loading="genMut.isPending.value"
          @click="genMut.mutate()"
        >
          {{ t('integrations.regenerateConfirm') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
