<script setup lang="ts">
/**
 * 我的工单列表。
 *
 * 布局取自原型 my-tickets.html：状态统计条 → 页签 → 筛选 → 表格。
 * 统计条与页签用的是同一份数据（后端一次返回 tickets + total + counts），
 * 所以切页签不需要重新算统计，只是换一次列表查询。
 *
 * counts 是**全量**统计，不随筛选条件变化 —— 后端 TicketStatusCounts 只按
 * user_id 过滤。这是有意的：页签上的数字要能告诉用户「另一个页签里有几条」，
 * 若跟着当前筛选走，非当前页签永远显示 0，页签就失去了导航价值。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Search, TicketIcon, Plus, Paperclip, X } from 'lucide-vue-next'
import {
  listMyTickets,
  createTicket,
  emptyTicketList,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_CATEGORIES,
  TICKET_PRIORITY,
  type Ticket,
  type TicketStatus,
  type TicketPriority,
  type TicketCategory,
} from '@/api/tickets'
import PageHeader from '@/components/ui/PageHeader.vue'
import DataTable, { type Column } from '@/components/ui/DataTable.vue'
import Pagination from '@/components/ui/Pagination.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
import FormField from '@/components/ui/FormField.vue'
import TicketStatusPill from '@/components/console/TicketStatusPill.vue'
import TicketPriorityTag from '@/components/console/TicketPriorityTag.vue'
import { formatDateTime, formatRelative } from '@/lib/format'

const { t } = useI18n()
const router = useRouter()
const qc = useQueryClient()

const PAGE_SIZE = 20
const page = ref(1)

/** 'all' 不是后端状态，仅表示不传 status 参数 */
const tab = ref<TicketStatus | 'all'>('all')
const category = ref('')
const priority = ref('')
const orderBy = ref('')

/** 搜索：回车才发请求，避免每输一个字打一次接口 */
const searchInput = ref('')
const keyword = ref('')
function applySearch() {
  keyword.value = searchInput.value.trim()
  page.value = 1
}

// 换任何筛选都回第一页，否则会停在一个不存在的页码上
watch([tab, category, priority, orderBy], () => (page.value = 1))

const listQ = useQuery({
  queryKey: computed(() => [
    'tickets',
    page.value,
    tab.value,
    category.value,
    priority.value,
    orderBy.value,
    keyword.value,
  ]),
  queryFn: () =>
    listMyTickets({
      page: page.value,
      page_size: PAGE_SIZE,
      ...(tab.value !== 'all' ? { status: tab.value } : {}),
      ...(category.value ? { category: category.value } : {}),
      ...(priority.value ? { priority: priority.value } : {}),
      ...(orderBy.value ? { order_by: orderBy.value } : {}),
      ...(keyword.value ? { keyword: keyword.value } : {}),
    }),
})

const data = computed(() => listQ.data.value ?? emptyTicketList())
/** 后端 tickets 在无结果时可能是 null（Go 空切片序列化），统一成数组 */
const rows = computed<Ticket[]>(() => data.value.tickets ?? [])
const counts = computed(() => data.value.counts)
const totalAll = computed(() =>
  TICKET_STATUSES.reduce((sum, s) => sum + (counts.value[s] ?? 0), 0),
)

function tabCount(tb: TicketStatus | 'all') {
  return tb === 'all' ? totalAll.value : (counts.value[tb] ?? 0)
}

const columns = computed<Column[]>(() => [
  { key: 'id', label: t('tickets.colId'), class: 'w-[90px]' },
  { key: 'title', label: t('tickets.colTitle') },
  { key: 'category', label: t('tickets.colCategory'), class: 'w-[130px]' },
  { key: 'priority', label: t('tickets.colPriority'), class: 'w-[80px]' },
  { key: 'status', label: t('tickets.colStatus'), class: 'w-[90px]' },
  { key: 'updated_at', label: t('tickets.colUpdated'), class: 'w-[130px]' },
])

/** 类型值不在六项白名单内时（历史数据/自定义）原样显示，不吞掉信息 */
function categoryLabel(value: string) {
  if (!value) return '—'
  return (TICKET_CATEGORIES as readonly string[]).includes(value)
    ? t(`tickets.category_${value}`)
    : value
}

function openDetail(id: number) {
  router.push({ name: 'console-ticket-detail', params: { id: String(id) } })
}

/* ---------- 新建工单 ---------- */

const showCreate = ref(false)
const form = ref({
  title: '',
  category: 'api' as TicketCategory,
  priority: TICKET_PRIORITY.NORMAL as TicketPriority,
  content: '',
  attachments: [] as string[],
})
const errors = ref<{ title?: string; content?: string }>({})
const fileInput = ref<HTMLInputElement | null>(null)

function resetForm() {
  form.value = {
    title: '',
    category: 'api',
    priority: TICKET_PRIORITY.NORMAL,
    content: '',
    attachments: [],
  }
  errors.value = {}
}

/**
 * 附件当前只收文件名 —— 后端尚未接真实存储，附件是元数据。
 * 交互上仍限制 6 个并允许移除，等真实上传落地时这里只需换掉取值来源。
 */
function onPickFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const picked = Array.from(input.files ?? []).map((f) => f.name)
  const room = 6 - form.value.attachments.length
  if (room > 0) form.value.attachments.push(...picked.slice(0, room))
  input.value = '' // 清空才能再次选同一个文件
}

const createM = useMutation({
  mutationFn: () =>
    createTicket({
      title: form.value.title.trim(),
      type: form.value.category,
      category: form.value.category,
      priority: form.value.priority,
      content: form.value.content.trim(),
      attachments: form.value.attachments,
    }),
  onSuccess: (res) => {
    toast.success(t('tickets.createdOk'))
    showCreate.value = false
    resetForm()
    qc.invalidateQueries({ queryKey: ['tickets'] })
    qc.invalidateQueries({ queryKey: ['tickets-unread'] })
    // 直接进详情：用户刚写完描述，最想确认的是「它长什么样」
    if (res?.ticket?.id) openDetail(res.ticket.id)
  },
  onError: (e: Error) => toast.error(e.message),
})

function submitCreate() {
  errors.value = {}
  if (!form.value.title.trim()) errors.value.title = t('tickets.errTitleRequired')
  if (!form.value.content.trim()) errors.value.content = t('tickets.errContentRequired')
  if (errors.value.title || errors.value.content) return
  createM.mutate()
}
</script>

<template>
  <div>
    <PageHeader :title="t('tickets.title')" :description="t('tickets.subtitle')">
      <template #actions>
        <AppButton variant="primary" size="sm" @click="showCreate = true">
          <Plus class="size-3.5" />
          {{ t('tickets.create') }}
        </AppButton>
      </template>
    </PageHeader>

    <!-- 状态页签。数字为全量统计，与当前筛选无关 -->
    <div class="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
      <button
        v-for="tb in (['all', ...TICKET_STATUSES] as const)"
        :key="tb"
        type="button"
        role="tab"
        :aria-selected="tab === tb"
        class="-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors"
        :class="
          tab === tb
            ? 'border-border-selected font-medium text-fg'
            : 'border-transparent text-fg-muted hover:text-fg'
        "
        @click="tab = tb"
      >
        {{ tb === 'all' ? t('tickets.tabAll') : t(`tickets.status_${tb}`) }}
        <span
          class="rounded-full bg-bg-muted px-1.5 text-[10.5px] tabular-nums text-fg-muted"
        >
          {{ tabCount(tb) }}
        </span>
      </button>
    </div>

    <!-- 筛选 -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <select
        v-model="category"
        :aria-label="t('tickets.filterCategory')"
        class="h-8 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-border-selected"
      >
        <option value="">{{ t('tickets.allCategories') }}</option>
        <option v-for="c in TICKET_CATEGORIES" :key="c" :value="c">
          {{ t(`tickets.category_${c}`) }}
        </option>
      </select>

      <select
        v-model="priority"
        :aria-label="t('tickets.filterPriority')"
        class="h-8 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-border-selected"
      >
        <option value="">{{ t('tickets.allPriorities') }}</option>
        <option v-for="p in TICKET_PRIORITIES" :key="p" :value="p">
          {{ t(`tickets.priority_${p}`) }}
        </option>
      </select>

      <select
        v-model="orderBy"
        :aria-label="t('tickets.orderBy')"
        class="h-8 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-border-selected"
      >
        <option value="">{{ t('tickets.orderLatest') }}</option>
        <option value="created">{{ t('tickets.orderCreated') }}</option>
        <option value="priority">{{ t('tickets.orderPriority') }}</option>
      </select>

      <div class="relative">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
        />
        <input
          v-model="searchInput"
          type="search"
          :placeholder="t('tickets.searchPlaceholder')"
          class="h-8 w-[240px] rounded-lg border border-border bg-bg pl-8 pr-2.5 text-[12.5px] outline-none focus:border-border-selected"
          @keydown.enter="applySearch"
        />
      </div>
    </div>

    <DataTable
      :columns="columns"
      :rows="rows"
      :row-key="(r) => r.id"
      :loading="listQ.isLoading.value"
      :error="listQ.error.value ? String(listQ.error.value.message) : null"
      :skeleton-rows="6"
      row-clickable
      @retry="listQ.refetch()"
      @row-click="openDetail($event.id)"
    >
      <template #empty>
        <TicketIcon class="mx-auto size-7 text-fg-subtle" />
        <p class="mt-3 text-[13.5px] font-medium">{{ t('tickets.emptyTitle') }}</p>
        <p class="mt-1 text-[12.5px] text-fg-subtle">{{ t('tickets.emptyDesc') }}</p>
        <AppButton class="mt-4" variant="primary" size="sm" @click="showCreate = true">
          <Plus class="size-3.5" />
          {{ t('tickets.create') }}
        </AppButton>
      </template>

      <template #cell="{ row, column }">
        <template v-if="column.key === 'id'">
          <span class="font-mono text-[12px] text-fg-muted">#{{ row.id }}</span>
        </template>

        <template v-else-if="column.key === 'title'">
          <div class="flex w-full items-center gap-1.5 text-left">
            <span class="truncate font-medium">{{ row.title }}</span>
            <!-- 未读红点：unread_for_user 由后端在客服回复时累加 -->
            <span
              v-if="row.unread_for_user > 0"
              class="shrink-0 rounded-full bg-danger-bg px-1.5 text-[10.5px] font-medium tabular-nums text-danger-fg"
              :title="t('tickets.unreadTip', { n: row.unread_for_user })"
            >
              {{ row.unread_for_user }}
            </span>
          </div>
          <p v-if="row.last_message" class="mt-0.5 truncate text-[11.5px] text-fg-subtle">
            {{ row.last_message }}
          </p>
        </template>

        <template v-else-if="column.key === 'category'">
          <span class="text-[12.5px] text-fg-muted">
            {{ categoryLabel(row.category || row.type) }}
          </span>
        </template>

        <template v-else-if="column.key === 'priority'">
          <TicketPriorityTag :priority="row.priority" />
        </template>

        <template v-else-if="column.key === 'status'">
          <TicketStatusPill :status="row.status" />
        </template>

        <template v-else-if="column.key === 'updated_at'">
          <span
            class="text-[12.5px] text-fg-muted"
            :title="formatDateTime(row.updated_at || row.created_at)"
          >
            {{ formatRelative(row.updated_at || row.created_at) }}
          </span>
        </template>
      </template>
    </DataTable>

    <Pagination
      v-model:page="page"
      :page-size="PAGE_SIZE"
      :total="data.total"
      class="mt-4"
    />

    <!-- 新建工单 -->
    <AppModal
      :open="showCreate"
      :title="t('tickets.createTitle')"
      :description="t('tickets.createDesc')"
      :width="560"
      @close="showCreate = false"
    >
      <form class="space-y-4" @submit.prevent="submitCreate">
        <FormField
          id="tk-title"
          :label="t('tickets.formTitle')"
          :hint="t('tickets.formTitleHint')"
          :error="errors.title"
          required
        >
          <input
            id="tk-title"
            v-model="form.title"
            type="text"
            maxlength="100"
            :placeholder="t('tickets.formTitlePlaceholder')"
            class="h-9 w-full rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-selected"
          />
        </FormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <FormField id="tk-category" :label="t('tickets.formCategory')">
            <select
              id="tk-category"
              v-model="form.category"
              class="h-9 w-full rounded-lg border border-border bg-bg px-2 text-[13px] outline-none focus:border-border-selected"
            >
              <option v-for="c in TICKET_CATEGORIES" :key="c" :value="c">
                {{ t(`tickets.category_${c}`) }}
              </option>
            </select>
          </FormField>

          <FormField id="tk-priority" :label="t('tickets.formPriority')">
            <select
              id="tk-priority"
              v-model="form.priority"
              class="h-9 w-full rounded-lg border border-border bg-bg px-2 text-[13px] outline-none focus:border-border-selected"
            >
              <option v-for="p in TICKET_PRIORITIES" :key="p" :value="p">
                {{ t(`tickets.priority_${p}`) }}
              </option>
            </select>
          </FormField>
        </div>

        <FormField
          id="tk-content"
          :label="t('tickets.formContent')"
          :hint="t('tickets.formContentHint')"
          :error="errors.content"
          required
        >
          <textarea
            id="tk-content"
            v-model="form.content"
            rows="6"
            maxlength="5000"
            :placeholder="t('tickets.formContentPlaceholder')"
            class="w-full resize-y rounded-lg border border-border bg-bg px-2.5 py-2 text-[13px] outline-none focus:border-border-selected"
          />
        </FormField>

        <FormField
          id="tk-files"
          :label="t('tickets.formAttachments')"
          :hint="t('tickets.formAttachmentsHint')"
        >
          <input
            id="tk-files"
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="onPickFiles"
          />
          <div class="flex flex-wrap items-center gap-1.5">
            <span
              v-for="(name, i) in form.attachments"
              :key="`${name}-${i}`"
              class="inline-flex max-w-[200px] items-center gap-1 rounded-lg border border-border bg-bg-subtle px-2 py-1 text-[11.5px]"
            >
              <Paperclip class="size-3 shrink-0 text-fg-subtle" />
              <span class="truncate">{{ name }}</span>
              <button
                type="button"
                class="shrink-0 text-fg-subtle transition-colors hover:text-danger-fg"
                :aria-label="t('tickets.removeFile')"
                @click="form.attachments.splice(i, 1)"
              >
                <X class="size-3" />
              </button>
            </span>
            <AppButton
              v-if="form.attachments.length < 6"
              size="sm"
              @click="fileInput?.click()"
            >
              <Paperclip class="size-3.5" />
              {{ t('tickets.addFile') }}
            </AppButton>
          </div>
        </FormField>
      </form>

      <template #footer>
        <AppButton size="sm" @click="showCreate = false">{{ t('common.cancel') }}</AppButton>
        <AppButton
          variant="primary"
          size="sm"
          :loading="createM.isPending.value"
          @click="submitCreate"
        >
          {{ t('common.submit') }}
        </AppButton>
      </template>
    </AppModal>
  </div>
</template>
