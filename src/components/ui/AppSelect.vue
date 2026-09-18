<script setup lang="ts" generic="T extends string">
/**
 * 单选下拉。
 *
 * 存在的理由是原生 <select> 的弹层由浏览器画 —— 直角面板、系统字体、
 * 跟不了主题色，和站内其它下拉（模型库分组、密钥有效期）摆在一起明显是两套东西。
 * 所以这里用「按钮 + 绝对定位面板」自绘，圆角/边框/阴影沿用模型库分组下拉那套
 * （rounded-lg），与工单页自己的输入框、搜索框保持同一档圆角。
 *
 * 代价是键盘和无障碍要自己补：role=listbox/option、方向键、Home/End、Esc。
 * 原生 select 白送这些，自绘就得还债，别删。
 */
import { computed, nextTick, ref, onMounted, onBeforeUnmount } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'

const model = defineModel<T>({ required: true })

const props = withDefaults(
  defineProps<{
    options: readonly { value: T; label: string }[]
    /** sm 用于筛选栏（h-8），md 用于表单（h-9） */
    size?: 'sm' | 'md'
    /** 选中值不在 options 里时的兜底文案 */
    placeholder?: string
    id?: string
    ariaLabel?: string
    disabled?: boolean
  }>(),
  { size: 'md' },
)

const open = ref(false)
const wrap = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

/** 键盘游标。与 model 分离：移动高亮时不应真的改值 */
const cursor = ref(-1)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === model.value)?.label ?? props.placeholder ?? '',
)

const sizing = computed(() =>
  props.size === 'sm' ? 'h-8 px-2.5 text-[12.5px]' : 'h-9 px-3 text-[13px]',
)

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (!open.value) return
  // 打开时把游标落在当前选中项上，方向键从这里继续
  cursor.value = props.options.findIndex((o) => o.value === model.value)
  await nextTick()
  scrollCursorIntoView()
}

function close() {
  open.value = false
  cursor.value = -1
}

function pick(v: T) {
  model.value = v
  close()
}

/** 长列表里高亮项可能在可视区外，跟着滚 */
function scrollCursorIntoView() {
  const el = panel.value?.children[cursor.value] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest' })
}

async function move(delta: number) {
  if (!open.value) {
    await toggle()
    return
  }
  const n = props.options.length
  if (!n) return
  cursor.value = (cursor.value + delta + n) % n
  await nextTick()
  scrollCursorIntoView()
}

async function jump(to: 'first' | 'last') {
  if (!open.value || !props.options.length) return
  cursor.value = to === 'first' ? 0 : props.options.length - 1
  await nextTick()
  scrollCursorIntoView()
}

/** 面板打开时回车/空格是「确认高亮项」，关闭时是「打开」（交给 toggle） */
function confirm(e: KeyboardEvent) {
  if (!open.value) {
    e.preventDefault()
    void toggle()
    return
  }
  const opt = props.options[cursor.value]
  if (opt) {
    e.preventDefault()
    pick(opt.value)
  }
}

function onDocClick(e: MouseEvent) {
  if (!wrap.value?.contains(e.target as Node)) close()
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="wrap" class="relative">
    <button
      :id="id"
      type="button"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      :disabled="disabled"
      class="motion-press flex w-full items-center gap-2 rounded-lg border border-border bg-bg outline-none transition-colors focus-visible:border-border-selected disabled:opacity-50"
      :class="[sizing, open ? 'border-border-selected' : '']"
      @click="toggle"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.home.prevent="jump('first')"
      @keydown.end.prevent="jump('last')"
      @keydown.esc="close"
      @keydown.enter="confirm"
      @keydown.space="confirm"
    >
      <span class="truncate" :class="selectedLabel ? '' : 'text-fg-muted'">
        {{ selectedLabel || placeholder }}
      </span>
      <ChevronDown
        class="ml-auto size-3.5 shrink-0 text-fg-subtle transition-transform"
        :class="open ? 'rotate-180' : ''"
      />
    </button>

    <div
      v-if="open"
      ref="panel"
      role="listbox"
      :aria-label="ariaLabel"
      class="absolute left-0 top-full z-20 mt-1.5 max-h-72 min-w-full overflow-y-auto rounded-lg border border-border bg-bg-elevated py-1 shadow-lg"
    >
      <button
        v-for="(o, i) in options"
        :key="o.value"
        type="button"
        role="option"
        :aria-selected="o.value === model"
        class="motion-press flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left"
        :class="i === cursor ? 'bg-bg-muted' : 'hover:bg-bg-muted'"
        @click="pick(o.value)"
        @mousemove="cursor = i"
      >
        <Check v-if="o.value === model" class="size-3.5 shrink-0 text-fg" />
        <span v-else class="size-3.5 shrink-0" />
        <span class="flex-1 text-[12.5px] font-medium text-fg">{{ o.label }}</span>
      </button>
    </div>
  </div>
</template>
