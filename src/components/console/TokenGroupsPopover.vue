<script setup lang="ts">
/**
 * 分组列的内联编辑弹层。
 *
 * 为什么 Teleport + fixed 而不是 absolute：DataTable 外层是 overflow-hidden、
 * 内层滚动容器是 overflow-auto，单元格里的绝对定位面板会被两层裁掉。
 * 所以传送到 body，靠触发按钮的 getBoundingClientRect() 定位。
 *
 * 层级取 z-[50]：压在 AppModal(z-60) / toast(z-70) 之下。
 */
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import GroupSelector from './GroupSelector.vue'
import AppSwitch from '../ui/AppSwitch.vue'
import AppButton from '../ui/AppButton.vue'

const { t } = useI18n()

const props = defineProps<{
  open: boolean
  /** 触发按钮，定位基准 */
  anchor: HTMLElement | null
  options: string[]
  meta?: Record<string, { desc?: string; ratio?: number | string }>
  counts?: Map<string, number>
  models?: Map<string, string[]>
  saving?: boolean
}>()

const emit = defineEmits<{ close: []; save: [] }>()

/** 草稿：v-model 双向绑给父级，取消时由父级丢弃 */
const groups = defineModel<string[]>('groups', { required: true })
const retry = defineModel<boolean>('retry', { required: true })

const PANEL_W = 340
const MARGIN = 8
const GAP = 6

const panel = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0, maxHeight: 420 })

function place() {
  const a = props.anchor
  const p = panel.value
  if (!a || !p) return

  const r = a.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  // 触发器被滚出可视区了，留个孤零零的浮层没有意义
  if (r.bottom < 0 || r.top > vh) {
    emit('close')
    return
  }

  const h = p.offsetHeight
  const below = vh - r.bottom - GAP - MARGIN
  const above = r.top - GAP - MARGIN
  // 下方放不下、且上方更宽裕时向上翻转
  const flip = below < h && above > below

  pos.value = {
    top: flip ? Math.max(MARGIN, r.top - GAP - h) : r.bottom + GAP,
    // 左对齐按钮；右侧溢出时整体左推，再夹住左边缘
    left: Math.max(MARGIN, Math.min(r.left, vw - PANEL_W - MARGIN)),
    // 空间不足时压缩面板让它内部滚动，而不是溢出视口
    maxHeight: Math.max(200, flip ? above : below),
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    // 面板可能开在弹窗之上，别让 AppModal 的 Escape 一起把弹窗也关了
    e.stopImmediatePropagation()
    emit('close')
  }
}

/**
 * 外部点击关闭。面板是 teleport 到 body 的，**不是触发按钮的后代**，
 * 所以两处都得单独放行；另外用 mousedown 而非 click —— 页面上已有的
 * onDocClick 监听冒泡阶段的 click，同一次点击「刚打开就被关掉」的竞态
 * 就是这么来的。
 */
function onDown(e: MouseEvent) {
  const target = e.target as Node
  if (panel.value?.contains(target)) return
  if (props.anchor?.contains(target)) return
  emit('close')
}

function attach() {
  // capture 是必须的，不是优化：scroll 不冒泡，表格内层滚动容器的事件
  // 只有在捕获阶段才会经过 window
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('mousedown', onDown, true)
}

function detach() {
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('resize', place)
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('mousedown', onDown, true)
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      detach()
      return
    }
    // 面板得先进 DOM 才量得到 offsetHeight
    await nextTick()
    place()
    attach()
  },
)

// 排序/增删会改变面板高度，向上翻转时不重算会肉眼可见地飘
watch(
  () => groups.value.length,
  async () => {
    if (!props.open) return
    await nextTick()
    place()
  },
)

onBeforeUnmount(detach)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="panel"
      class="fixed z-[50] flex flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg"
      :style="{
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        width: `${PANEL_W}px`,
        maxHeight: `${pos.maxHeight}px`,
      }"
    >
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <p class="mb-2 text-[12.5px] font-semibold text-fg">{{ t('keys.groupTitle') }}</p>

        <GroupSelector
          v-model="groups"
          :options="options"
          :meta="meta"
          :counts="counts"
          :models="models"
          :disabled="saving"
        />

        <div class="mt-3 flex items-start justify-between gap-3 border-t border-border pt-3">
          <div class="min-w-0">
            <p class="text-[12.5px] font-medium text-fg">{{ t('keys.crossGroupRetry') }}</p>
            <p class="mt-0.5 text-[11px] leading-snug text-fg-subtle">
              {{ t('keys.crossGroupHint') }}
            </p>
          </div>
          <AppSwitch v-model="retry" :disabled="saving" :label="t('keys.crossGroupRetry')" />
        </div>
      </div>

      <div class="flex shrink-0 justify-end gap-2 border-t border-border px-3 py-2">
        <AppButton size="sm" variant="ghost" :disabled="saving" @click="emit('close')">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton
          size="sm"
          variant="primary"
          :loading="saving"
          :disabled="!groups.length"
          @click="emit('save')"
        >
          {{ t('common.save') }}
        </AppButton>
      </div>
    </div>
  </Teleport>
</template>
