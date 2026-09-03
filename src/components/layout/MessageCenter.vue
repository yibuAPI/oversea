<script setup lang="ts">
/**
 * 消息中心 —— 顶栏铃铛弹出的面板，仿参考站的「系统公告 / 通知」双标签布局。
 *
 * 后端有两套公告体系，前端按语义对应（见 controller/misc.go、setting/console_setting）：
 *   - 「系统公告」→ /api/notice（getNotice）→ 读 OptionMap["Notice"] 单条字符串，
 *     按 NoticeVisibility 过滤 role 后原样下发。见 store.loadNotice()。
 *   - 「通知」   → /api/status（getStatus）→ inject data.announcements
 *     （console_setting.Announcements，JSON 数组，每项含 content/publishDate/
 *     type/visibility/extra），AnnouncementsEnabled 开启时下发。见 auth.ts。
 * 面板以此为据：系统公告在上，通知在下。
 */
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bell, Megaphone } from 'lucide-vue-next'
import AppModal from '@/components/ui/AppModal.vue'
import RichContent from '@/components/common/RichContent.vue'
import { useSiteStore } from '@/stores/site'
import { isLikelyHtml } from '@/utils/content-format'
import type { AnnouncementItem } from '@/api/types'

const { t, locale } = useI18n()
const site = useSiteStore()

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

type Tab = 'system' | 'notifications'
/** 默认停在「系统公告」—— 面板上方标签，对应 /api/notice */
const active = ref<Tab>('system')

/** 组件挂载时拉取系统公告（status 已在 main.ts 预热，notice 独立请求一次即可） */
onMounted(() => {
  site.loadNotice()
})

/** content 判型（html / markdown）需要知道原始字符串，富文本渲染需在内容侧处理 */
function contentMode(content: string | undefined): 'html' | 'markdown' {
  const raw = (content ?? '').trim()
  return raw && isLikelyHtml(raw) ? 'html' : 'markdown'
}

/** 系统公告（/api/notice → store.notice，后端已按 role 过滤） */
const notice = computed(() => site.notice ?? '')
const noticeEmpty = computed(() => !notice.value.trim())

/** /api/status 数据是否已加载（store 在 main.ts 预热，通常已有值） */
const statusLoaded = computed(() => site.status !== null)
const loading = computed(() => !statusLoaded.value && site.loading)

/** 通知列表（/api/status → data.announcements，后端已按 role 过滤 visibility，前端直接展示） */
const announcements = computed<AnnouncementItem[]>(
  () => site.status?.announcements ?? [],
)
const hasAnnouncements = computed(() => announcements.value.length > 0)

function isTab(key: Tab) {
  return active.value === key
}

/** 公告类型圆点配色（default/ongoing/success/warning/error） */
const TYPE_DOTS: Record<string, string> = {
  default: 'bg-fg-muted',
  ongoing: 'bg-accent',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
}
function typeDot(type: string | undefined): string {
  return (type && TYPE_DOTS[type]) || TYPE_DOTS.default
}

/** publishDate 是 RFC3339 串，格式化为本地日期 */
function formatDate(value: string | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
</script>

<template>
  <AppModal
    :open="open"
    :title="t('notice.messageCenter')"
    :width="860"
    @close="emit('close')"
  >
    <!-- -mx-5 抵消 AppModal 内胆的 px-5，让左侧边栏贴到面板左缘 -->
    <div class="-mx-5 flex">
      <!-- 左：标签栏，系统公告在上 -->
      <nav
        class="w-44 shrink-0 border-r border-border p-2"
        role="tablist"
        aria-label="消息中心"
      >
        <button
          type="button"
          role="tab"
          :aria-selected="isTab('system')"
          class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors"
          :class="
            isTab('system')
              ? 'bg-bg-muted font-medium text-fg'
              : 'text-fg-secondary hover:bg-bg-muted/60 hover:text-fg'
          "
          @click="active = 'system'"
        >
          <Megaphone class="size-4 shrink-0" />
          {{ t('notice.system') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="isTab('notifications')"
          class="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors"
          :class="
            isTab('notifications')
              ? 'bg-bg-muted font-medium text-fg'
              : 'text-fg-secondary hover:bg-bg-muted/60 hover:text-fg'
          "
          @click="active = 'notifications'"
        >
          <Bell class="size-4 shrink-0" />
          {{ t('notice.notifications') }}
        </button>
      </nav>

      <!-- 右：内容区。固定 h-[70dvh]：两个标签、各加载/错误/空态/内容态高度一致，切换不跳动 -->
      <div class="min-w-0 flex-1 self-stretch px-5 py-1" role="tabpanel">
        <div class="flex h-[70dvh] flex-col">
          <!-- 系统公告：/api/notice 单条字符串 -->
          <template v-if="isTab('system')">
            <!-- 加载骨架：/api/notice 尚未返回 -->
            <div v-if="site.noticeLoading" class="space-y-3 py-2">
              <div class="h-4 w-3/4 animate-pulse rounded bg-bg-muted" />
              <div class="h-4 w-1/2 animate-pulse rounded bg-bg-muted" />
              <div class="h-28 w-full animate-pulse rounded-xl border border-border bg-bg-elevated" />
            </div>

            <!-- 公告接口报错 -->
            <div
              v-else-if="site.noticeError"
              class="flex flex-1 flex-col items-center justify-center text-center"
            >
              <p class="text-[13.5px] text-fg-muted">{{ t('notice.error') }}</p>
              <button
                type="button"
                class="mt-4 rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
                @click="site.loadNotice()"
              >
                {{ t('common.retry') }}
              </button>
            </div>

            <!-- 空内容 -->
            <div
              v-else-if="noticeEmpty"
              class="flex flex-1 flex-col items-center justify-center text-center"
            >
              <div class="flex size-12 items-center justify-center rounded-full bg-bg-muted text-fg-muted">
                <Megaphone class="size-5" />
              </div>
              <p class="mt-3 text-[13.5px] text-fg-muted">{{ t('notice.noticeEmpty') }}</p>
            </div>

            <!-- 渲染公告正文 -->
            <div v-else class="min-h-0 flex-1 overflow-y-auto py-1">
              <RichContent
                :mode="contentMode(notice)"
                :content="notice.trim()"
              />
            </div>
          </template>

          <!-- 通知：/api/status → data.announcements 列表 -->
          <template v-else>
            <!-- 加载骨架：/api/status 尚未返回 -->
            <div v-if="loading" class="space-y-3 py-2">
              <div class="h-4 w-3/4 animate-pulse rounded bg-bg-muted" />
              <div class="h-4 w-1/2 animate-pulse rounded bg-bg-muted" />
              <div class="h-28 w-full animate-pulse rounded-xl border border-border bg-bg-elevated" />
            </div>

            <!-- 状态接口报错 -->
            <div
              v-else-if="site.error"
              class="flex flex-1 flex-col items-center justify-center text-center"
            >
              <p class="text-[13.5px] text-fg-muted">{{ t('notice.error') }}</p>
              <button
                type="button"
                class="mt-4 rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
                @click="site.load()"
              >
                {{ t('common.retry') }}
              </button>
            </div>

            <!-- 空内容 -->
            <div
              v-else-if="!hasAnnouncements"
              class="flex flex-1 flex-col items-center justify-center text-center"
            >
              <div class="flex size-12 items-center justify-center rounded-full bg-bg-muted text-fg-muted">
                <Bell class="size-5" />
              </div>
              <p class="mt-3 text-[13.5px] text-fg-muted">{{ t('notice.empty') }}</p>
            </div>

            <!-- 渲染通知列表 -->
            <div v-else class="min-h-0 flex-1 overflow-y-auto py-1">
              <div
                v-for="(item, i) in announcements"
                :key="`${item.publishDate ?? 'announce'}-${i}`"
                class="border-b border-border py-4 last:border-b-0 first:pt-1"
              >
                <div class="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    class="size-2 rounded-full"
                    :class="typeDot(item.type)"
                    :title="item.type"
                    aria-hidden="true"
                  />
                  <span v-if="formatDate(item.publishDate)" class="text-[12px] text-fg-muted">
                    {{ formatDate(item.publishDate) }}
                  </span>
                </div>
                <RichContent
                  :mode="contentMode(item.content)"
                  :content="(item.content ?? '').trim()"
                />
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </AppModal>
</template>
