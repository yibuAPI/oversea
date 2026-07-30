<script setup lang="ts">
/**
 * 模态框。用于新建密钥、确认删除等。
 *
 * 无障碍要点：Escape 关闭、打开时锁 body 滚动、role=dialog + aria-modal、
 * 打开后把焦点移进面板（否则键盘用户的焦点还留在页面底下）。
 */
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  title: string
  description?: string
  /** 面板最大宽度，默认 480 */
  width?: number
}>()
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  async (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      document.addEventListener('keydown', onKey)
      await nextTick()
      panel.value?.focus()
    } else {
      document.removeEventListener('keydown', onKey)
    }
  },
)

onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
        @click.self="emit('close')"
      >
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          class="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-bg-elevated shadow-lg outline-none sm:rounded-2xl"
          :style="{ maxWidth: `${width ?? 480}px` }"
        >
          <div class="flex items-start gap-3 border-b border-border px-5 py-4">
            <div class="min-w-0 flex-1">
              <h2 class="text-[15px] font-semibold tracking-tight">{{ title }}</h2>
              <p v-if="description" class="mt-0.5 text-[12.5px] text-fg-muted">
                {{ description }}
              </p>
            </div>
            <button
              type="button"
              class="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-bg-muted hover:text-fg"
              aria-label="关闭"
              @click="emit('close')"
            >
              <X class="size-4" />
            </button>
          </div>

          <div class="px-5 py-4">
            <slot />
          </div>

          <div
            v-if="$slots.footer"
            class="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
