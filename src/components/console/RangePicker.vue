<script setup lang="ts">
/**
 * 时间范围选择。Usage / Cost / Logs 三页共用。
 *
 * 后端 /api/data/self 硬限 30 天跨度，所以预设里没有「90 天」这种选项 ——
 * 给了也是报错，不如不给。自定义模式下超限会就地提示。
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MAX_RANGE_SECONDS } from '@/api/usage'

export type RangePreset = '24h' | '7d' | '14d' | '30d' | 'custom'

const props = defineProps<{ preset: RangePreset; start: number; end: number }>()
const emit = defineEmits<{
  'update:preset': [RangePreset]
  'update:start': [number]
  'update:end': [number]
}>()

const { t } = useI18n()

const PRESETS: { key: RangePreset; seconds: number }[] = [
  { key: '24h', seconds: 86400 },
  { key: '7d', seconds: 7 * 86400 },
  { key: '14d', seconds: 14 * 86400 },
  { key: '30d', seconds: 30 * 86400 },
]

function pick(p: RangePreset) {
  emit('update:preset', p)
  if (p === 'custom') return
  const seconds = PRESETS.find((x) => x.key === p)?.seconds ?? 7 * 86400
  const now = Math.floor(Date.now() / 1000)
  emit('update:end', now)
  emit('update:start', now - seconds)
}

const toDateInput = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10)

const customStart = ref(toDateInput(props.start))
const customEnd = ref(toDateInput(props.end))

watch(
  () => props.preset,
  (p) => {
    if (p === 'custom') {
      customStart.value = toDateInput(props.start)
      customEnd.value = toDateInput(props.end)
    }
  },
)

const rangeError = computed(() => {
  if (props.preset !== 'custom') return null
  const s = Math.floor(new Date(customStart.value).getTime() / 1000)
  const e = Math.floor(new Date(`${customEnd.value}T23:59:59`).getTime() / 1000)
  if (!Number.isFinite(s) || !Number.isFinite(e)) return t('range.errInvalid')
  if (e < s) return t('range.errOrder')
  if (e - s > MAX_RANGE_SECONDS) return t('range.errTooLong')
  return null
})

function applyCustom() {
  if (rangeError.value) return
  emit('update:start', Math.floor(new Date(customStart.value).getTime() / 1000))
  emit('update:end', Math.floor(new Date(`${customEnd.value}T23:59:59`).getTime() / 1000))
}

watch([customStart, customEnd], applyCustom)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div
      class="inline-flex overflow-hidden rounded-lg border border-border"
      role="group"
      :aria-label="t('range.label')"
    >
      <button
        v-for="p in PRESETS"
        :key="p.key"
        type="button"
        class="motion-press h-8 px-2.5 text-[12.5px]"
        :class="
          preset === p.key
            ? 'bg-bg-inset font-medium text-fg'
            : 'text-fg-muted hover:bg-bg-muted'
        "
        :aria-pressed="preset === p.key"
        @click="pick(p.key)"
      >
        {{ t(`range.preset_${p.key}`) }}
      </button>
      <button
        type="button"
        class="motion-press h-8 border-l border-border px-2.5 text-[12.5px]"
        :class="
          preset === 'custom'
            ? 'bg-bg-inset font-medium text-fg'
            : 'text-fg-muted hover:bg-bg-muted'
        "
        :aria-pressed="preset === 'custom'"
        @click="pick('custom')"
      >
        {{ t('range.custom') }}
      </button>
    </div>

    <div v-if="preset === 'custom'" class="flex items-center gap-1.5">
      <input
        v-model="customStart"
        type="date"
        :aria-label="t('range.from')"
        class="h-8 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-accent"
      />
      <span class="text-fg-subtle" aria-hidden="true">–</span>
      <input
        v-model="customEnd"
        type="date"
        :aria-label="t('range.to')"
        class="h-8 rounded-lg border border-border bg-bg px-2 text-[12.5px] outline-none focus:border-accent"
      />
    </div>

    <p v-if="rangeError" class="text-[11.5px] text-danger-fg">{{ rangeError }}</p>
  </div>
</template>
