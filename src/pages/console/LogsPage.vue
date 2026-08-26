<script setup lang="ts">
/**
 * 日志。对齐 infron Logs 页的三个 tab（Logs / Tasks / Media Tasks），
 * 分别打到三个后端接口：
 *   /api/log/self   调用与账务日志（含登录、充值、消费）
 *   /api/task/self   异步任务（视频等）
 *   /api/mj/self     绘图任务
 *
 * enable_task / enable_drawing 关闭时对应 tab 直接不显示 ——
 * 后端会返回空，但让用户点进空 tab 是差体验。
 */
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { Search, ScrollText, ChevronDown } from 'lucide-vue-next'
import { useSiteStore } from '@/stores/site'
import { listLogs, listTasks, listMidjourney } from '@/api/usage'
import { LOG_TYPE, type LogEntry } from '@/api/types'
import PageHeader from '@/components/ui/PageHeader.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import RangePicker, { type RangePreset } from '@/components/console/RangePicker.vue'
import {
  formatCompact,
  formatDateTime,
  formatDuration,
  formatInt,
  formatQuota,
} from '@/lib/format'

const site = useSiteStore()
const { quotaPerUnit, status } = storeToRefs(site)
const { t } = useI18n()

type Tab = 'logs' | 'tasks' | 'media'

const taskEnabled = computed(() => status.value?.enable_task === true)
const drawingEnabled = computed(() => status.value?.enable_drawing === true)

const tabs = computed<Tab[]>(() => {
  const out: Tab[] = ['logs']
  if (taskEnabled.value) out.push('tasks')
  if (drawingEnabled.value) out.push('media')
  return out
})

const tab = ref<Tab>('logs')

const preset = ref<RangePreset>('7d')
const now = Math.floor(Date.now() / 1000)
const start = ref(now - 7 * 86400)
const end = ref(now)

const page = ref(1)
const PAGE_SIZE = 20

/** 搜索框：ID 或模型名。回车才触发，避免每输一个字打一次接口 */
const searchInput = ref('')
const search = ref('')
const logType = ref<number>(LOG_TYPE.ALL)

function applySearch() {
  search.value = searchInput.value.trim()
  page.value = 1
}

// 切 tab / 换筛选都要回第一页，否则会停在一个不存在的页码上
watch([tab, start, end, logType], () => (page.value = 1))

const logsQ = useQuery({
  queryKey: computed(() => [
    'logs',
    page.value,
    start.value,
    end.value,
    logType.value,
    search.value,
  ]),
  queryFn: () =>
    listLogs({
      p: page.value,
      page_size: PAGE_SIZE,
      type: logType.value || undefined,
      start_timestamp: start.value,
      end_timestamp: end.value,
      // 后端没有「模糊搜索」，只有精确的 request_id 和 model_name。
      // 以 sk- 或长十六进制形态判断为 request_id，否则当模型名。
      ...(search.value
        ? /^[0-9a-zA-Z]{20,}$/.test(search.value)
          ? { request_id: search.value }
          : { model_name: search.value }
        : {}),
    }),
  enabled: computed(() => tab.value === 'logs'),
})

const tasksQ = useQuery({
  queryKey: computed(() => ['tasks', page.value, start.value, end.value, search.value]),
  queryFn: () =>
    listTasks({
      p: page.value,
      page_size: PAGE_SIZE,
      start_timestamp: start.value,
      end_timestamp: end.value,
      ...(search.value ? { task_id: search.value } : {}),
    }),
  enabled: computed(() => tab.value === 'tasks'),
})

const mediaQ = useQuery({
  queryKey: computed(() => ['mj', page.value, start.value, end.value, search.value]),
  queryFn: () =>
    listMidjourney({
      p: page.value,
      page_size: PAGE_SIZE,
      start_timestamp: String(start.value),
      end_timestamp: String(end.value),
      ...(search.value ? { mj_id: search.value } : {}),
    }),
  enabled: computed(() => tab.value === 'media'),
})

const active = computed(() =>
  tab.value === 'logs' ? logsQ : tab.value === 'tasks' ? tasksQ : mediaQ,
)
const total = computed(() => active.value.data.value?.total ?? 0)

const LOG_TYPES = [
  LOG_TYPE.ALL,
  LOG_TYPE.CONSUME,
  LOG_TYPE.TOPUP,
  LOG_TYPE.ERROR,
  LOG_TYPE.REFUND,
  LOG_TYPE.LOGIN,
  LOG_TYPE.SYSTEM,
  LOG_TYPE.MANAGE,
]

const TYPE_META: Record<number, string> = {
  [LOG_TYPE.TOPUP]: 'border-success-border bg-success-bg text-success-fg',
  [LOG_TYPE.CONSUME]: 'border-border bg-bg-muted text-fg-muted',
  [LOG_TYPE.ERROR]: 'border-danger-border bg-danger-bg text-danger-fg',
  [LOG_TYPE.REFUND]: 'border-warning-border bg-warning-bg text-warning-fg',
  [LOG_TYPE.LOGIN]: 'border-info-border bg-info-bg text-info-fg',
}

const logColumns = computed<Column[]>(() => [
  { key: 'created_at', label: t('logs.colTime'), class: 'w-[150px]' },
  { key: 'type', label: t('logs.colType'), class: 'w-[80px]' },
  { key: 'model_name', label: t('logs.colModel') },
  { key: 'tokens', label: t('logs.colTokens'), class: 'w-[120px]', numeric: true },
  { key: 'cache', label: t('logs.colCache'), class: 'w-[120px]', numeric: true },
  { key: 'use_time', label: t('logs.colLatency'), class: 'w-[90px]', numeric: true },
  { key: 'quota', label: t('logs.colCost'), class: 'w-[110px]', numeric: true },
])

/** 展开行看 content / other 明细 */
const expanded = ref<number | null>(null)

/** other 是 JSON 串，解析失败就不展示（不要抛错弄崩表格） */
function parseOther(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

/**
 * 缓存 token 读写。
 *
 * LogEntry 上没有独立字段，数值埋在 other 这个 JSON 串里，而不同上游
 * （OpenAI / Anthropic / 后端自己的汇总）用的键名不一致，所以按候选键
 * 依次取第一个能拿到的数字，取不到就算 0。
 *   读 = 命中缓存、按折扣价计费的部分
 *   写 = 建立缓存、通常比普通输入更贵的部分
 */
const CACHE_READ_KEYS = [
  'cache_tokens',
  'cached_tokens',
  'cache_read_tokens',
  'cache_read_input_tokens',
]
const CACHE_WRITE_KEYS = [
  'cache_creation_tokens',
  'cache_write_tokens',
  'cache_creation_input_tokens',
]

function pickNumber(o: Record<string, unknown> | null, keys: string[]): number {
  if (!o) return 0
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    // 有的后端把计数写成字符串
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return Number(v)
    }
  }
  return 0
}

function cacheTokens(row: LogEntry): { read: number; write: number } {
  const o = parseOther(row.other)
  return {
    read: pickNumber(o, CACHE_READ_KEYS),
    write: pickNumber(o, CACHE_WRITE_KEYS),
  }
}

/**
 * 按行预解析。模板里一个单元格要读好几次读写值，
 * 直接调 cacheTokens 会把同一行的 other 反复 JSON.parse 一遍。
 */
const cacheByRow = computed(() => {
  const m = new Map<number, { read: number; write: number }>()
  for (const row of logsQ.data.value?.items ?? []) m.set(row.id, cacheTokens(row))
  return m
})

const EMPTY_CACHE = { read: 0, write: 0 }
const rowCache = (id: number) => cacheByRow.value.get(id) ?? EMPTY_CACHE
</script>

<template>
  <div>
    <PageHeader :title="t('logs.title')" :description="t('logs.subtitle')" />

    <!-- tabs -->
    <div class="mb-4 flex gap-1 border-b border-border" role="tablist">
      <button
        v-for="tb in tabs"
        :key="tb"
        type="button"
        role="tab"
        :aria-selected="tab === tb"
        class="-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors"
        :class="
          tab === tb
            ? 'border-accent font-medium text-fg'
            : 'border-transparent text-fg-muted hover:text-fg'
        "
        @click="tab = tb"
      >
        {{ t(`logs.tab_${tb}`) }}
      </button>
    </div>

    <!-- 筛选 -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <RangePicker v-model:preset="preset" v-model:start="start" v-model:end="end" />

      <select
        v-if="tab === 'logs'"
        v-model.number="logType"
        :aria-label="t('logs.colType')"
        class="h-8 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-accent"
      >
        <option v-for="ty in LOG_TYPES" :key="ty" :value="ty">
          {{ t(`logs.type_${ty}`) }}
        </option>
      </select>

      <div class="relative">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
        />
        <input
          v-model="searchInput"
          type="search"
          :placeholder="tab === 'logs' ? t('logs.searchLog') : t('logs.searchTask')"
          class="h-8 w-[240px] rounded-lg border border-border bg-bg pl-8 pr-2.5 text-[12.5px] outline-none focus:border-accent"
          @keydown.enter="applySearch"
        />
      </div>
    </div>

    <!-- 日志 tab -->
    <template v-if="tab === 'logs'">
      <DataTable
        :columns="logColumns"
        :rows="logsQ.data.value?.items ?? []"
        :row-key="(r) => r.id"
        :loading="logsQ.isLoading.value"
        :error="logsQ.error.value ? String(logsQ.error.value.message) : null"
        :skeleton-rows="8"
        @retry="logsQ.refetch()"
      >
        <template #empty>
          <ScrollText class="mx-auto size-7 text-fg-subtle" />
          <p class="mt-3 text-[13.5px] font-medium">{{ t('logs.emptyTitle') }}</p>
          <p class="mt-1 text-[12.5px] text-fg-subtle">{{ t('logs.emptyDesc') }}</p>
        </template>

        <template #cell="{ row, column }">
          <template v-if="column.key === 'created_at'">
            <button
              type="button"
              class="flex items-center gap-1 text-left transition-colors hover:text-accent"
              @click="expanded = expanded === row.id ? null : row.id"
            >
              {{ formatDateTime(row.created_at) }}
              <ChevronDown
                class="size-3 shrink-0 transition-transform"
                :class="expanded === row.id ? 'rotate-180' : ''"
              />
            </button>
          </template>

          <template v-else-if="column.key === 'type'">
            <span
              class="inline-flex rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium"
              :class="TYPE_META[row.type] ?? 'border-border bg-bg-muted text-fg-muted'"
            >
              {{ t(`logs.type_${row.type}`) }}
            </span>
          </template>

          <template v-else-if="column.key === 'model_name'">
            <p class="truncate">
              {{ row.model_name || row.content || '—' }}
            </p>
            <p v-if="row.token_name || row.group" class="mt-0.5 truncate text-[11px] text-fg-subtle">
              {{ [row.token_name, row.group].filter(Boolean).join(' · ') }}
              <template v-if="row.is_stream"> · stream</template>
            </p>
            <!-- 展开明细 -->
            <div
              v-if="expanded === row.id"
              class="mt-2 space-y-1 rounded-lg bg-bg-subtle p-2.5 text-[11.5px]"
            >
              <p v-if="row.content" class="text-fg-muted">{{ row.content }}</p>
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
                <template v-if="row.request_id">
                  <dt class="text-fg-subtle">request_id</dt>
                  <dd class="truncate">{{ row.request_id }}</dd>
                </template>
                <template v-if="row.channel_name">
                  <dt class="text-fg-subtle">channel</dt>
                  <dd class="truncate">{{ row.channel_name }}</dd>
                </template>
                <template v-if="row.ip">
                  <dt class="text-fg-subtle">ip</dt>
                  <dd class="truncate">{{ row.ip }}</dd>
                </template>
                <template v-for="(v, k) in parseOther(row.other) ?? {}" :key="k">
                  <dt class="text-fg-subtle">{{ k }}</dt>
                  <dd class="truncate">
                    {{ typeof v === 'object' ? JSON.stringify(v) : String(v) }}
                  </dd>
                </template>
              </dl>
            </div>
          </template>

          <template v-else-if="column.key === 'tokens'">
            <span v-if="row.prompt_tokens || row.completion_tokens">
              <span :class="row.prompt_tokens ? 'text-success-fg' : 'text-fg-subtle'">
                {{ formatCompact(row.prompt_tokens) }}
              </span>
              /
              <span :class="row.completion_tokens ? '' : 'text-fg-subtle'">
                {{ formatCompact(row.completion_tokens) }}
              </span>
            </span>
            <span v-else class="text-fg-subtle">—</span>
          </template>

          <template v-else-if="column.key === 'cache'">
            <span
              v-if="rowCache(row.id).read || rowCache(row.id).write"
              :title="
                t('logs.cacheTip', {
                  r: formatInt(rowCache(row.id).read),
                  w: formatInt(rowCache(row.id).write),
                })
              "
            >
              <span :class="rowCache(row.id).read ? 'text-success-fg' : 'text-fg-subtle'">
                {{ formatCompact(rowCache(row.id).read) }}
              </span>
              /
              <span :class="rowCache(row.id).write ? '' : 'text-fg-subtle'">
                {{ formatCompact(rowCache(row.id).write) }}
              </span>
            </span>
            <span v-else class="text-fg-subtle">—</span>
          </template>

          <template v-else-if="column.key === 'use_time'">
            <span :class="row.use_time ? '' : 'text-fg-subtle'">
              {{ formatDuration(row.use_time) }}
            </span>
          </template>

          <template v-else-if="column.key === 'quota'">
            <span
              :class="
                row.type === LOG_TYPE.TOPUP || row.type === LOG_TYPE.REFUND
                  ? 'text-success-fg'
                  : ''
              "
            >
              {{
                row.quota
                  ? formatQuota(row.quota, quotaPerUnit, {
                      sign: row.type === LOG_TYPE.TOPUP || row.type === LOG_TYPE.REFUND,
                    })
                  : '—'
              }}
            </span>
          </template>
        </template>
      </DataTable>
    </template>

    <!-- 任务 tab -->
    <template v-else-if="tab === 'tasks'">
      <DataTable
        :columns="[
          { key: 'submit_time', label: t('logs.colTime'), class: 'w-[150px]' },
          { key: 'platform', label: t('logs.colPlatform'), class: 'w-[110px]' },
          { key: 'action', label: t('logs.colAction') },
          { key: 'status', label: t('logs.colStatus'), class: 'w-[110px]' },
          { key: 'progress', label: t('logs.colProgress'), class: 'w-[90px]' },
          { key: 'quota', label: t('logs.colCost'), class: 'w-[110px]', numeric: true },
        ]"
        :rows="tasksQ.data.value?.items ?? []"
        :row-key="(r) => r.id"
        :loading="tasksQ.isLoading.value"
        :error="tasksQ.error.value ? String(tasksQ.error.value.message) : null"
        :skeleton-rows="8"
        @retry="tasksQ.refetch()"
      >
        <template #empty>
          <p class="text-[13px] text-fg-subtle">{{ t('logs.emptyTasks') }}</p>
        </template>
        <template #cell="{ row, column }">
          <template v-if="column.key === 'submit_time'">
            {{ formatDateTime(row.submit_time || row.created_at) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <p class="truncate">{{ row.action || '—' }}</p>
            <p class="mt-0.5 truncate font-mono text-[10.5px] text-fg-subtle">
              {{ row.task_id }}
            </p>
            <p v-if="row.fail_reason" class="mt-0.5 truncate text-[11px] text-danger-fg">
              {{ row.fail_reason }}
            </p>
          </template>
          <template v-else-if="column.key === 'status'">
            <span
              class="inline-flex rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium"
              :class="
                row.status === 'SUCCESS'
                  ? 'border-success-border bg-success-bg text-success-fg'
                  : row.status === 'FAILURE'
                    ? 'border-danger-border bg-danger-bg text-danger-fg'
                    : 'border-border bg-bg-muted text-fg-muted'
              "
            >
              {{ row.status || '—' }}
            </span>
          </template>
          <template v-else-if="column.key === 'progress'">
            {{ row.progress || '—' }}
          </template>
          <template v-else-if="column.key === 'quota'">
            {{ row.quota ? formatQuota(row.quota, quotaPerUnit) : '—' }}
          </template>
        </template>
      </DataTable>
    </template>

    <!-- 绘图 tab -->
    <template v-else>
      <DataTable
        :columns="[
          { key: 'submit_time', label: t('logs.colTime'), class: 'w-[150px]' },
          { key: 'action', label: t('logs.colAction'), class: 'w-[110px]' },
          { key: 'prompt', label: t('logs.colPrompt') },
          { key: 'status', label: t('logs.colStatus'), class: 'w-[110px]' },
          { key: 'quota', label: t('logs.colCost'), class: 'w-[110px]', numeric: true },
        ]"
        :rows="mediaQ.data.value?.items ?? []"
        :row-key="(r) => r.id"
        :loading="mediaQ.isLoading.value"
        :error="mediaQ.error.value ? String(mediaQ.error.value.message) : null"
        :skeleton-rows="8"
        @retry="mediaQ.refetch()"
      >
        <template #empty>
          <p class="text-[13px] text-fg-subtle">{{ t('logs.emptyMedia') }}</p>
        </template>
        <template #cell="{ row, column }">
          <template v-if="column.key === 'submit_time'">
            {{ formatDateTime(row.submit_time) }}
          </template>
          <template v-else-if="column.key === 'prompt'">
            <p class="line-clamp-2 max-w-[420px]">{{ row.prompt || '—' }}</p>
            <a
              v-if="row.image_url"
              :href="row.image_url"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-0.5 inline-block text-[11px] text-accent hover:underline"
            >
              {{ t('logs.viewImage') }}
            </a>
          </template>
          <template v-else-if="column.key === 'status'">
            <span
              class="inline-flex rounded-full border px-1.5 py-0.5 text-[10.5px] font-medium"
              :class="
                row.status === 'SUCCESS'
                  ? 'border-success-border bg-success-bg text-success-fg'
                  : row.status === 'FAILURE'
                    ? 'border-danger-border bg-danger-bg text-danger-fg'
                    : 'border-border bg-bg-muted text-fg-muted'
              "
            >
              {{ row.status || '—' }}
            </span>
          </template>
          <template v-else-if="column.key === 'quota'">
            {{ row.quota ? formatQuota(row.quota, quotaPerUnit) : '—' }}
          </template>
          <template v-else>{{ (row as unknown as Record<string, unknown>)[column.key] || '—' }}</template>
        </template>
      </DataTable>
    </template>

    <Pagination v-model:page="page" :page-size="PAGE_SIZE" :total="total" />
  </div>
</template>
