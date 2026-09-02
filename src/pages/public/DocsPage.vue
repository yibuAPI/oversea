<script setup lang="ts">
/**
 * 文档站 /docs —— 版式对照 infron.ai/docs（GitBook）：
 *
 *   顶栏     通栏（跟随主题）：logo + 居中搜索框（Ctrl K）+ 右侧「模型 / 登录」
 *   tab 条   顶栏下的横向分区 tab（Document / API 分组）
 *   左栏     分组目录树（OVERVIEW / INTEGRATION / REFERENCE），子页缩进
 *   正文     品牌渐变横幅（仅首页）→ 面包屑 + Copy → emoji 大标题 → 区块流
 *   右栏     ON THIS PAGE（当前页内 h2 锚点）
 *   页底     上一页 / 下一页
 *
 * 独立 chrome：不套 PublicLayout 的悬浮药丸导航 —— infron 的文档站
 * 就是一套独立的 GitBook 皮，与主站导航不同。
 *
 * 内容树在 docs-content.ts；本文件只负责渲染与交互
 * （搜索过滤、锚点高亮、代码 tab、复制）。
 */
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  Search,
  Check,
  Copy,
  ChevronRight,
  ChevronLeft,
  Sun,
  Moon,
  Languages,
  AlignLeft,
  TriangleAlert,
  Info,
  Menu,
  X,
} from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { useThemeStore } from '@/stores/theme'
import { DOCS_BASE_URL } from '@/utils/content-format'
import { getPricing } from '@/api/models'
import { setLocale } from '@/i18n'
import { buildDocs, type Block } from './docs-content'

const site = useSiteStore()
const theme = useThemeStore()
const { systemName, logo } = storeToRefs(site)
const { isDark } = storeToRefs(theme)
const { t, tm, locale } = useI18n()
const route = useRoute()
const router = useRouter()

function toggleLocale() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}

const pricingQ = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

// 文档展示的接口基址固定为 DOCS_BASE_URL，不随后端 server_address 变化；
// 否则用户复制走的代码会打到后端配置的旧域名（本地为 localhost）。
const baseUrl = DOCS_BASE_URL

const sampleModel = computed(() => {
  const first = pricingQ.data.value?.data?.find((m) => m.quota_type === 0)
  return first?.model_name ?? 'gpt-4o-mini'
})

/** FAQ 复用首页 i18n 的问答，文档与落地页口径一致 */
const faqItems = computed(() => {
  const keys = ['models', 'billing', 'compat', 'limits', 'support'] as const
  return keys
    .map((k) => ({
      q: t(`home.faq.${k}.q`),
      a: t(`home.faq.${k}.a`),
    }))
    .filter((f) => f.q && !f.q.startsWith('home.'))
})
void tm

const docs = computed(() =>
  buildDocs({
    zh: locale.value === 'zh-CN',
    base: baseUrl,
    model: sampleModel.value,
    name: systemName.value,
    faq: faqItems.value,
  }),
)

/** 当前页 key 从 ?page= 读，无效值回落到 quickstart */
const pageKey = computed(() => {
  const q = route.query.page
  const k = typeof q === 'string' ? q : 'quickstart'
  return docs.value.pages[k] ? k : 'quickstart'
})
const page = computed(() => docs.value.pages[pageKey.value])

function goto(key: string) {
  router.push({ path: '/docs', query: key === 'quickstart' ? {} : { page: key } })
  mobileNav.value = false
}

const idx = computed(() => docs.value.order.indexOf(pageKey.value))
const prevPage = computed(() =>
  idx.value > 0 ? docs.value.pages[docs.value.order[idx.value - 1]] : null,
)
const nextPage = computed(() =>
  idx.value >= 0 && idx.value < docs.value.order.length - 1
    ? docs.value.pages[docs.value.order[idx.value + 1]]
    : null,
)

// ───────── 搜索：过滤目录树 ─────────
const search = ref('')
const filteredGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return docs.value.groups
  return docs.value.groups
    .map((g) => ({
      ...g,
      items: g.items.filter((k) => {
        const p = docs.value.pages[k]
        const hay = [
          p.title,
          ...(p.children ?? []).map((c) => docs.value.pages[c]?.title ?? ''),
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      }),
    }))
    .filter((g) => g.items.length)
})

/** Ctrl/⌘+K 聚焦搜索框 */
const searchEl = ref<HTMLInputElement | null>(null)
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchEl.value?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

// ───────── ON THIS PAGE：h2 锚点 ─────────
const toc = computed(() =>
  page.value.blocks.filter((b): b is Extract<Block, { type: 'h2' }> => b.type === 'h2'),
)
const activeAnchor = ref('')

let observer: IntersectionObserver | undefined
function observeAnchors() {
  observer?.disconnect()
  if (!toc.value.length) return
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) activeAnchor.value = visible.target.id
    },
    { rootMargin: '-120px 0px -60% 0px' },
  )
  for (const h of toc.value) {
    const el = document.getElementById(h.id)
    if (el) observer.observe(el)
  }
}
onMounted(() => observeAnchors())
watch(pageKey, async () => {
  activeAnchor.value = ''
  window.scrollTo({ top: 0 })
  await nextTick()
  observeAnchors()
})
onUnmounted(() => observer?.disconnect())

// ───────── 代码块：tab + 复制 ─────────
/** 每个代码块各自记住选中的 tab（按块索引存） */
const codeTab = ref<Record<number, string>>({})
watch(pageKey, () => (codeTab.value = {}))

function activeTab(bi: number, tabs: { key: string }[]) {
  return codeTab.value[bi] ?? tabs[0]?.key
}

const copied = ref<string | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => clearTimeout(copyTimer))
async function copy(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = id
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = null), 1500)
  } catch {
    /* 剪贴板不可用时静默 */
  }
}

/** 「Copy page」：把当前页正文拼成 markdown 复制 —— 喂给 LLM 用 */
function copyPage() {
  const p = page.value
  const lines: string[] = [`# ${p.title}`, '']
  for (const b of p.blocks) {
    if (b.type === 'p') lines.push(b.text, '')
    else if (b.type === 'h2') lines.push(`## ${b.text}`, '')
    else if (b.type === 'list')
      lines.push(...b.items.map((i) => `- ${i.strong ? `**${i.strong}** — ` : ''}${i.text}`), '')
    else if (b.type === 'cards')
      lines.push(...b.items.map((c) => `- **${c.title}**: ${c.desc}${c.meta ? ` (${c.meta})` : ''}`), '')
    else if (b.type === 'code')
      for (const tab of b.tabs) lines.push(`\`\`\`\n${tab.code}\n\`\`\``, '')
    else if (b.type === 'rows')
      lines.push(...b.items.map((r) => `- ${r.a} ${r.b}${r.c ? ` — ${r.c}` : ''}`), '')
    else if (b.type === 'callout') lines.push(`> ${b.text}`, '')
  }
  copy(lines.join('\n'), 'page')
}

const mobileNav = ref(false)
</script>

<template>
  <div class="min-h-dvh bg-bg text-fg">
    <!-- ============ 顶栏（跟随主题：日间浅色 / 夜间深色） ============ -->
    <header class="fixed inset-x-0 top-0 z-50 border-b border-border bg-bg">
      <div class="flex h-14 items-center gap-4 px-4 lg:px-6">
        <button
          type="button"
          class="rounded-md p-1.5 text-fg-muted hover:text-fg lg:hidden"
          :aria-label="t('nav.menu')"
          @click="mobileNav = !mobileNav"
        >
          <component :is="mobileNav ? X : Menu" class="size-5" />
        </button>

        <RouterLink to="/" class="flex shrink-0 items-center gap-2">
          <img :src="logo" :alt="systemName" class="h-5 w-auto" />
          <span class="text-[15px] font-semibold text-fg">{{ systemName }}</span>
        </RouterLink>

        <!-- 居中搜索框 -->
        <div class="relative mx-auto hidden w-full max-w-[520px] sm:block">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <input
            ref="searchEl"
            v-model="search"
            type="search"
            :placeholder="t('publicDocs.searchPlaceholder')"
            class="h-9 w-full rounded-lg border border-border bg-bg-muted pl-9 pr-16 text-[13.5px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent"
          />
          <span
            class="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 gap-1"
            aria-hidden="true"
          >
            <kbd
              class="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-fg-subtle"
            >
              Ctrl
            </kbd>
            <kbd
              class="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-fg-subtle"
            >
              K
            </kbd>
          </span>
        </div>

        <nav class="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <RouterLink
            to="/models"
            class="hidden rounded-md px-2.5 py-1.5 text-[13.5px] text-fg-muted transition-colors hover:text-fg sm:block"
          >
            {{ t('nav.models') }}
          </RouterLink>
          <RouterLink
            to="/login"
            class="hidden rounded-md px-2.5 py-1.5 text-[13.5px] text-fg-muted transition-colors hover:text-fg sm:block"
          >
            {{ t('auth.signIn') }}
          </RouterLink>
          <button
            type="button"
            class="rounded-md p-2 text-fg-muted transition-colors hover:text-fg"
            aria-label="Switch language"
            @click="toggleLocale"
          >
            <Languages class="size-4" />
          </button>
          <button
            type="button"
            class="rounded-md p-2 text-fg-muted transition-colors hover:text-fg"
            :aria-label="t('theme.toggle')"
            @click="theme.toggle()"
          >
            <component :is="isDark ? Sun : Moon" class="size-4" />
          </button>
        </nav>
      </div>
    </header>

    <div class="mx-auto flex max-w-[1440px] gap-8 px-4 pt-14 lg:px-8">
      <!-- ============ 左栏目录树 ============ -->
      <aside
        class="fixed inset-y-0 left-0 z-40 w-[270px] overflow-y-auto border-r border-border bg-bg pb-10 pt-[72px] transition-transform lg:sticky lg:top-14 lg:z-auto lg:h-[calc(100dvh-3.5rem)] lg:w-[250px] lg:translate-x-0 lg:border-0 lg:bg-transparent lg:pt-8"
        :class="mobileNav ? 'translate-x-0 shadow-lg' : '-translate-x-full'"
      >
        <nav class="px-4 lg:px-0" :aria-label="t('publicDocs.navLabel')">
          <div v-for="g in filteredGroups" :key="g.key" class="mb-7">
            <p class="px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {{ g.title }}
            </p>
            <ul class="mt-2 space-y-0.5">
              <li v-for="k in g.items" :key="k">
                <button
                  type="button"
                  class="motion-press flex w-full items-center gap-2 rounded-lg px-3 py-[7px] text-left text-[13.5px]"
                  :class="
                    pageKey === k
                      ? 'bg-accent-bg font-medium text-accent'
                      : 'text-fg-muted hover:bg-bg-muted hover:text-fg'
                  "
                  @click="goto(k)"
                >
                  <span v-if="docs.pages[k].emoji" class="text-[15px]">
                    {{ docs.pages[k].emoji }}
                  </span>
                  {{ docs.pages[k].title }}
                  <ChevronRight
                    v-if="docs.pages[k].children?.length"
                    class="ml-auto size-3.5 transition-transform"
                    :class="pageKey === k || docs.pages[k].children?.includes(pageKey) ? 'rotate-90' : ''"
                  />
                </button>

                <!-- 子页：父页或兄弟选中时展开 -->
                <ul
                  v-if="
                    docs.pages[k].children?.length &&
                    (pageKey === k || docs.pages[k].children?.includes(pageKey))
                  "
                  class="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2"
                >
                  <li v-for="c in docs.pages[k].children" :key="c">
                    <button
                      type="button"
                      class="motion-press w-full rounded-lg px-3 py-[6px] text-left text-[13px]"
                      :class="
                        pageKey === c
                          ? 'bg-accent-bg font-medium text-accent'
                          : 'text-fg-muted hover:bg-bg-muted hover:text-fg'
                      "
                      @click="goto(c)"
                    >
                      {{ docs.pages[c].title }}
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </nav>
      </aside>

      <!-- 移动端目录遮罩 -->
      <div
        v-if="mobileNav"
        class="fixed inset-0 z-30 cursor-pointer bg-black/40 lg:hidden"
        @click="mobileNav = false"
      />

      <!-- ============ 正文 ============ -->
      <div class="min-w-0 flex-1 pb-24 pt-8">
        <!-- 品牌渐变横幅：仅首页 -->
        <div v-if="page.banner" class="relative mb-10 overflow-hidden rounded-xl">
          <img
            src="/hero-gradient.png"
            alt=""
            class="absolute inset-0 size-full object-cover dark:invert dark:hue-rotate-180"
            aria-hidden="true"
          />
          <div class="relative px-8 py-12 text-center lg:py-14">
            <p
              class="font-serif text-[24px] leading-snug text-[#0b1c33] lg:text-[30px] dark:text-white"
            >
              {{ t('publicDocs.bannerLine1') }}<em class="text-accent-solid">{{ t('publicDocs.bannerEm') }}</em><br />
              {{ t('publicDocs.bannerLine2') }}
            </p>
          </div>
        </div>

        <!-- 面包屑 + Copy page -->
        <div class="flex flex-wrap items-center gap-3">
          <nav aria-label="Breadcrumb" class="flex items-center gap-1.5 text-[13px]">
            <button type="button" class="text-accent hover:underline" @click="goto('quickstart')">
              {{ t('publicDocs.crumbRoot') }}
            </button>
            <ChevronRight class="size-3.5 text-fg-subtle" />
            <span class="text-fg-muted">{{ page.title }}</span>
          </nav>
          <button
            type="button"
            class="motion-press ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-fg-muted hover:bg-bg-muted hover:text-fg"
            @click="copyPage"
          >
            <Check v-if="copied === 'page'" class="size-3.5 text-success-fg" />
            <Copy v-else class="size-3.5" />
            {{ t('publicDocs.copyPage') }}
          </button>
        </div>

        <!-- 标题 -->
        <h1 class="mt-5 flex items-center gap-3 text-[32px] font-bold tracking-tight lg:text-[38px]">
          <span v-if="page.emoji" aria-hidden="true">{{ page.emoji }}</span>
          {{ page.title }}
        </h1>
        <p v-if="page.subtitle" class="mt-2 text-[16px] text-fg-muted">
          {{ page.subtitle }}
        </p>

        <!-- 区块流 -->
        <div class="mt-8 space-y-6">
          <template v-for="(b, bi) in page.blocks" :key="bi">
            <!-- 段落 -->
            <p v-if="b.type === 'p'" class="max-w-[760px] text-[15px] leading-[1.75] text-fg-secondary">
              {{ b.text }}
            </p>

            <!-- 小节标题 -->
            <h2
              v-else-if="b.type === 'h2'"
              :id="b.id"
              class="scroll-mt-20 pt-4 text-[22px] font-bold tracking-tight"
            >
              {{ b.text }}
            </h2>

            <!-- 要点列表 -->
            <ul v-else-if="b.type === 'list'" class="max-w-[760px] space-y-2.5">
              <li v-for="(it, ii) in b.items" :key="ii" class="flex gap-3 text-[15px] leading-[1.7]">
                <span class="mt-[11px] size-1.5 shrink-0 rounded-full bg-fg" aria-hidden="true" />
                <span>
                  <strong v-if="it.strong" class="font-bold">{{ it.strong }}</strong>
                  <span :class="it.strong ? 'text-fg-secondary' : ''">
                    {{ it.strong ? ' — ' : '' }}{{ it.text }}
                  </span>
                </span>
              </li>
            </ul>

            <!-- 能力卡网格 -->
            <div v-else-if="b.type === 'cards'" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div
                v-for="c in b.items"
                :key="c.title"
                class="rounded-xl border border-border bg-bg-elevated p-5"
              >
                <h3 class="text-[15px] font-bold">{{ c.title }}</h3>
                <p class="mt-2 text-[13px] leading-relaxed text-fg-muted">{{ c.desc }}</p>
                <p v-if="c.meta" class="mt-3 font-mono text-[11.5px] text-fg-subtle">
                  {{ c.meta }}
                </p>
              </div>
            </div>

            <!-- 代码块（多 tab + 复制） -->
            <div
              v-else-if="b.type === 'code'"
              class="overflow-hidden rounded-xl border border-border bg-bg-elevated"
            >
              <div class="flex items-center gap-1 overflow-x-auto border-b border-border bg-bg-subtle px-2">
                <template v-if="b.tabs.length > 1">
                  <button
                    v-for="tab in b.tabs"
                    :key="tab.key"
                    type="button"
                    class="-mb-px shrink-0 border-b-2 px-3 py-2.5 text-[12.5px] transition-colors"
                    :class="
                      activeTab(bi, b.tabs) === tab.key
                        ? 'border-accent font-medium text-fg'
                        : 'border-transparent text-fg-muted hover:text-fg'
                    "
                    @click="codeTab[bi] = tab.key"
                  >
                    {{ tab.label }}
                  </button>
                </template>
                <span v-else class="px-3 py-2.5 text-[12.5px] text-fg-muted">
                  {{ b.tabs[0]?.label }}
                </span>
                <button
                  type="button"
                  class="ml-auto mr-1 shrink-0 rounded-md p-1.5 text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
                  :aria-label="t('common.copy')"
                  @click="copy(b.tabs.find((x) => x.key === activeTab(bi, b.tabs))?.code ?? '', `code-${bi}`)"
                >
                  <Check v-if="copied === `code-${bi}`" class="size-3.5 text-success-fg" />
                  <Copy v-else class="size-3.5" />
                </button>
              </div>
              <pre
                class="overflow-x-auto p-5 font-mono text-[12.5px] leading-relaxed"
              ><code>{{ b.tabs.find((x) => x.key === activeTab(bi, b.tabs))?.code }}</code></pre>
            </div>

            <!-- 行列表（接口 / 错误码） -->
            <div
              v-else-if="b.type === 'rows'"
              class="max-w-[760px] divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-elevated"
            >
              <div
                v-for="(r, ri) in b.items"
                :key="ri"
                class="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <span
                  class="w-11 shrink-0 rounded border border-border bg-bg-subtle px-1 py-0.5 text-center font-mono text-[11px] font-medium text-fg-muted"
                >
                  {{ r.a }}
                </span>
                <code v-if="b.mono" class="font-mono text-[13px]">{{ r.b }}</code>
                <span v-else class="text-[13px]">{{ r.b }}</span>
                <span v-if="r.c" class="ml-auto text-[12.5px] text-fg-subtle">{{ r.c }}</span>
              </div>
            </div>

            <!-- 提示块 -->
            <div
              v-else-if="b.type === 'callout'"
              class="flex max-w-[760px] gap-3 rounded-xl border p-4 text-[13.5px] leading-relaxed"
              :class="
                b.tone === 'warning'
                  ? 'border-warning-border bg-warning-bg text-warning-fg'
                  : 'border-info-border bg-info-bg text-info-fg'
              "
            >
              <component
                :is="b.tone === 'warning' ? TriangleAlert : Info"
                class="mt-0.5 size-4 shrink-0"
              />
              <p>{{ b.text }}</p>
            </div>

            <!-- 内链按钮 -->
            <RouterLink
              v-else-if="b.type === 'link'"
              :to="b.to"
              class="inline-flex h-10 items-center gap-1.5 rounded-[20px] border border-border-strong px-[18px] text-[14px] transition-colors hover:bg-bg-muted"
            >
              {{ b.label }}
              <ChevronRight class="size-4" />
            </RouterLink>
          </template>
        </div>

        <!-- 上一页 / 下一页 -->
        <div class="mt-16 grid gap-4 border-t border-border pt-8 sm:grid-cols-2">
          <button
            v-if="prevPage"
            type="button"
            class="group flex items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-border-strong"
            @click="goto(prevPage.key)"
          >
            <ChevronLeft class="size-4 shrink-0 text-fg-subtle transition-transform group-hover:-translate-x-0.5" />
            <span>
              <span class="block text-[11.5px] uppercase tracking-wide text-fg-subtle">
                {{ t('publicDocs.prev') }}
              </span>
              <span class="mt-0.5 block text-[14px] font-medium">{{ prevPage.title }}</span>
            </span>
          </button>
          <span v-else class="hidden sm:block" />
          <button
            v-if="nextPage"
            type="button"
            class="group flex items-center justify-end gap-3 rounded-xl border border-border p-4 text-right transition-colors hover:border-border-strong"
            @click="goto(nextPage.key)"
          >
            <span>
              <span class="block text-[11.5px] uppercase tracking-wide text-fg-subtle">
                {{ t('publicDocs.next') }}
              </span>
              <span class="mt-0.5 block text-[14px] font-medium">{{ nextPage.title }}</span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>

      <!-- ============ 右栏 ON THIS PAGE ============ -->
      <aside class="hidden w-[200px] shrink-0 xl:block">
        <div v-if="toc.length" class="sticky top-14 pt-8">
          <p
            class="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle"
          >
            <AlignLeft class="size-3.5" />
            {{ t('publicDocs.onThisPage') }}
          </p>
          <ul class="mt-3 space-y-1.5">
            <li v-for="h in toc" :key="h.id">
              <a
                :href="`#${h.id}`"
                class="block text-[13px] transition-colors"
                :class="
                  activeAnchor === h.id
                    ? 'font-medium text-accent'
                    : 'text-fg-muted hover:text-fg'
                "
              >
                {{ h.text }}
              </a>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>
