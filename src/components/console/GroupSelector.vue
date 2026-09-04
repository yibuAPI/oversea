<script setup lang="ts">
/**
 * 分组选择器：上半部分是已选分组的有序列表（可上移/下移/移除），
 * 下半部分是全部可选分组的复选列表。
 *
 * 顺序对后端有语义 —— 请求按 groups 数组顺序寻找拥有目标模型的分组，
 * 靠前的优先。所以「排序」必须是可见、可控的，不能只靠勾选先后。
 *
 * 纯受控组件，自己不发请求：分组元数据由父级传入（父级两处都已有
 * groupsQ / pricingQ，再查一遍只是多一层加载态）。
 */
import { computed, ref, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, ArrowDown, X } from 'lucide-vue-next'

const { t } = useI18n()

const model = defineModel<string[]>({ required: true })

const props = defineProps<{
  /** 全部可选分组名 */
  options: string[]
  /** 分组元数据（描述 / 倍率），来自 /user/self/groups */
  meta?: Record<string, { desc?: string; ratio?: number | string }>
  /** 每个分组开放多少可用模型 */
  counts?: Map<string, number>
  /** 每个分组开放了哪些模型，悬停「N 可用模型」徽章时列出 */
  models?: Map<string, string[]>
  disabled?: boolean
}>()

/** 该分组是否开放了可用模型（0 个视为无，置灰提示） */
function hasModels(g: string) {
  return (props.counts?.get(g) ?? 0) > 0
}

/** 倍率：auto 分组在接口里可能是字符串，按 1 兜底 */
function ratioOf(g: string) {
  const v = props.meta?.[g]?.ratio
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1
}

/** 1 → "1"，0.25 → "0.25"（去掉浮点尾噪） */
const ratioLabel = (n: number) => String(Number.parseFloat(n.toFixed(2)))

/** 描述等于分组名时没有信息量，不显示 */
function descOf(g: string) {
  const d = props.meta?.[g]?.desc
  return d && d !== g ? d : ''
}

const TONES = [
  'text-sky-600 dark:text-sky-400',
  'text-violet-600 dark:text-violet-400',
  'text-amber-600 dark:text-amber-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-rose-600 dark:text-rose-400',
  'text-cyan-600 dark:text-cyan-400',
]

/** 给分组名映射一个稳定的文字色（同模型库的 toneOf） */
function toneOf(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0
  return TONES[Math.abs(h) % TONES.length]
}

/**
 * 可选列表 = 后端给的分组 ∪ 已选里那些后端已不再返回的「陈旧分组」。
 * 不并进来的话，陈旧分组在列表里既取消不掉也看不见来源。
 */
const allOptions = computed(() => {
  const seen = new Set(props.options)
  return [...props.options, ...model.value.filter((g) => !seen.has(g))]
})

/** 已不在后端分组表里的历史分组，单独标记提醒 */
const isStale = (g: string) => !props.options.includes(g)

function toggle(g: string) {
  if (props.disabled || !hasModels(g)) return
  const i = model.value.indexOf(g)
  if (i >= 0) model.value = model.value.filter((x) => x !== g)
  else model.value = [...model.value, g]
}

function move(i: number, delta: number) {
  const to = i + delta
  if (props.disabled || to < 0 || to >= model.value.length) return
  const next = [...model.value]
  const [item] = next.splice(i, 1)
  next.splice(to, 0, item!)
  model.value = next
}

function removeAt(i: number) {
  if (props.disabled) return
  model.value = model.value.filter((_, x) => x !== i)
}

// ───────────── 「N 可用模型」悬浮清单 ─────────────
//
// 传送到 body 而非就地绝对定位：这个组件会被塞进弹层的
// overflow-y-auto 容器里，绝对定位的浮层会被滚动区裁掉。

const TIP_W = 240
const TIP_MAX_H = 200
const MARGIN = 8

const tipGroup = ref<string | null>(null)
const tipPos = ref({ top: 0, left: 0 })

/**
 * 关闭延时。徽章和浮层之间有间隙，鼠标一离开徽章就关会让人根本移不进去；
 * 留一段宽限期，期间移进浮层就取消关闭。
 */
let tipTimer: ReturnType<typeof setTimeout> | null = null
function cancelClose() {
  if (tipTimer != null) {
    clearTimeout(tipTimer)
    tipTimer = null
  }
}

/** 悬停分组的模型清单（排序后便于扫读） */
const tipModels = computed(() => {
  const g = tipGroup.value
  if (!g) return []
  return [...(props.models?.get(g) ?? [])].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
})

async function openTip(g: string, e: MouseEvent) {
  cancelClose()
  if (!props.models?.get(g)?.length) return
  // 先量位置再显示：徽章的矩形现在就能取，晚了 currentTarget 会失效
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tipGroup.value = g
  await nextTick()

  const vw = window.innerWidth
  const vh = window.innerHeight
  // 默认贴在徽章右侧；右边放不下就翻到左侧
  const left =
    r.right + 6 + TIP_W + MARGIN <= vw ? r.right + 6 : Math.max(MARGIN, r.left - 6 - TIP_W)
  tipPos.value = {
    top: Math.max(MARGIN, Math.min(r.top, vh - TIP_MAX_H - MARGIN)),
    left,
  }
}

/** 宽限期内移进浮层即取消 */
function scheduleClose() {
  cancelClose()
  tipTimer = setTimeout(() => {
    tipGroup.value = null
    tipTimer = null
  }, 160)
}

onBeforeUnmount(() => {
  cancelClose()
  tipGroup.value = null
})
</script>

<template>
  <div>
    <!-- 说明 + 全部清除 -->
    <div class="mb-2 flex items-start gap-2">
      <p class="flex-1 text-[11.5px] leading-snug text-fg-subtle">
        {{ t('keys.groupOrderHint') }}
      </p>
      <button
        v-if="model.length"
        type="button"
        :disabled="disabled"
        class="motion-press shrink-0 rounded text-[11.5px] text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
        @click="model = []"
      >
        {{ t('keys.clearAll') }}
      </button>
    </div>

    <!-- 已选分组：有序，可调顺序 -->
    <ul v-if="model.length" class="mb-2 space-y-1">
      <li
        v-for="(g, i) in model"
        :key="g"
        class="flex items-center gap-2 rounded-lg bg-bg-muted px-2.5 py-2"
      >
        <span
          class="flex size-5 shrink-0 items-center justify-center rounded bg-bg-elevated text-[11px] font-semibold tabular text-fg-muted"
        >{{ i + 1 }}</span>
        <span class="min-w-0 flex-1 truncate text-[13px] font-medium" :class="toneOf(g)" :title="g">
          {{ g }}
        </span>
        <span v-if="isStale(g)" class="shrink-0 text-[10.5px] text-warning-fg">
          {{ t('keys.groupStale') }}
        </span>
        <button
          type="button"
          :disabled="disabled || i === 0"
          :title="t('keys.groupMoveUp')"
          :aria-label="t('keys.groupMoveUp')"
          class="motion-press flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
          @click="move(i, -1)"
        >
          <ArrowUp class="size-3.5" />
        </button>
        <button
          type="button"
          :disabled="disabled || i === model.length - 1"
          :title="t('keys.groupMoveDown')"
          :aria-label="t('keys.groupMoveDown')"
          class="motion-press flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-elevated hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent"
          @click="move(i, 1)"
        >
          <ArrowDown class="size-3.5" />
        </button>
        <button
          type="button"
          :disabled="disabled"
          :title="t('keys.groupRemove')"
          :aria-label="t('keys.groupRemove')"
          class="motion-press flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-danger-bg hover:text-danger-fg disabled:opacity-30"
          @click="removeAt(i)"
        >
          <X class="size-3.5" />
        </button>
      </li>
    </ul>
    <p v-else class="mb-2 rounded-lg bg-bg-muted px-2.5 py-2.5 text-[12px] text-fg-muted">
      {{ t('keys.fGroupPlaceholder') }}
    </p>

    <!-- 可选分组：勾选加入末尾 -->
    <div class="max-h-44 overflow-y-auto rounded-lg border border-border">
      <label
        v-for="g in allOptions"
        :key="g"
        class="flex cursor-pointer items-start gap-2.5 px-2.5 py-2 transition-colors hover:bg-bg-muted"
        :class="disabled || !hasModels(g) ? 'cursor-not-allowed opacity-60' : ''"
      >
        <input
          type="checkbox"
          :checked="model.includes(g)"
          :disabled="disabled || !hasModels(g)"
          class="mt-0.5 size-4 shrink-0 rounded border-border accent-[var(--color-btn-primary-bg)]"
          @change="toggle(g)"
        />
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-[12.5px] font-semibold text-fg" :title="g">{{ g }}</span>
          <span v-if="descOf(g)" class="truncate text-[11.5px] text-fg-muted" :title="descOf(g)">
            {{ descOf(g) }}
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1">
          <span
            v-if="hasModels(g)"
            class="rounded bg-success-bg px-2.5 py-1 text-[12.5px] font-medium leading-none text-success-fg"
            :class="models?.get(g)?.length ? 'cursor-help' : ''"
            @mouseenter="openTip(g, $event)"
            @mouseleave="scheduleClose"
          >
            {{ counts?.get(g) ?? 0 }}
          </span>
          <span
            v-else
            class="rounded bg-bg-muted px-2 py-1 text-[11.5px] font-medium leading-none text-fg-muted"
          >
            {{ t('keys.groupNoModels') }}
          </span>
          <span
            class="rounded bg-info-bg px-2.5 py-1 text-[12.5px] font-medium leading-none text-info-fg"
          >
            ×{{ ratioLabel(ratioOf(g)) }}
          </span>
        </span>
      </label>
    </div>

    <!-- 分组的可用模型清单。teleport 出去，避开外层弹层的滚动裁切 -->
    <Teleport to="body">
      <div
        v-if="tipGroup"
        class="fixed z-[60] overflow-hidden rounded-lg bg-[#2c2c30] p-2 shadow-lg"
        :style="{
          top: `${tipPos.top}px`,
          left: `${tipPos.left}px`,
          width: `${TIP_W}px`,
          maxHeight: `${TIP_MAX_H}px`,
        }"
        @mouseenter="cancelClose"
        @mouseleave="scheduleClose"
      >
        <div class="flex max-h-[184px] flex-wrap gap-1 overflow-y-auto">
          <span
            v-for="m in tipModels"
            :key="m"
            class="rounded bg-white/10 px-1.5 py-0.5 text-[10.5px] leading-none text-white/90"
          >{{ m }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>
