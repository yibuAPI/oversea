<script setup lang="ts">
/**
 * 模型排行 /rankings —— 公开接口 GET /api/rankings。
 *
 * 布局：模型榜（主表）+ 右侧厂商榜 + 涨跌幅。
 * share 是 0–1 的占比，直接画成横条 —— 榜单光有数字没有形状很难扫读。
 * top_movers / top_droppers 为空数组时整块不渲染，不摆空壳。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'
import { TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-vue-next'
import { getRankings } from '@/api/rankings'
import { formatCompact, formatPercent } from '@/lib/format'

const { t } = useI18n()

const rankQ = useQuery({ queryKey: ['rankings'], queryFn: getRankings })

const models = computed(() => rankQ.data.value?.models ?? [])
const vendors = computed(() => rankQ.data.value?.vendors ?? [])
const movers = computed(() => rankQ.data.value?.top_movers ?? [])
const droppers = computed(() => rankQ.data.value?.top_droppers ?? [])

/**
 * 名次变化：↑n / ↓n / — / NEW。
 * previous_rank 缺失 = 新上榜。
 */
function rankDelta(m: { rank: number; previous_rank?: number }) {
  if (typeof m.previous_rank !== 'number') return { kind: 'new' as const, n: 0 }
  const d = m.previous_rank - m.rank
  if (d > 0) return { kind: 'up' as const, n: d }
  if (d < 0) return { kind: 'down' as const, n: -d }
  return { kind: 'same' as const, n: 0 }
}
</script>

<template>
  <div class="mx-auto max-w-[1100px] px-6 pb-24 pt-[140px] lg:pt-[168px]">
    <p class="text-[18px] font-semibold leading-[21.6px] text-brand">
      {{ t('public.rankings.eyebrow') }}
    </p>
    <h1
      class="mt-4 max-w-[720px] text-[32px] font-semibold leading-[1.1] tracking-[-0.84px] lg:text-[42px]"
    >
      {{ t('public.rankings.title') }}
    </h1>
    <p class="mt-4 max-w-[650px] text-[16px] leading-[22.4px] text-fg-secondary">
      {{ t('public.rankings.subtitle') }}
    </p>

    <!-- 加载骨架 -->
    <div v-if="rankQ.isLoading.value" class="mt-10 space-y-2">
      <div
        v-for="i in 8"
        :key="i"
        class="h-14 animate-pulse rounded-lg border border-border bg-bg-elevated"
      />
    </div>

    <div
      v-else-if="rankQ.error.value"
      class="mt-10 rounded-[16px] border border-border bg-bg-elevated px-4 py-14 text-center"
    >
      <p class="text-[14px] text-danger-fg">{{ rankQ.error.value.message }}</p>
      <button
        type="button"
        class="motion-press mt-4 rounded-full border border-border px-4 py-2 text-[13px] text-fg-muted hover:bg-bg-muted hover:text-fg"
        @click="rankQ.refetch()"
      >
        {{ t('common.retry') }}
      </button>
    </div>

    <div
      v-else-if="!models.length"
      class="mt-10 rounded-[16px] border border-border bg-bg-elevated px-4 py-16 text-center"
    >
      <Trophy class="mx-auto size-7 text-fg-subtle" />
      <p class="mt-3 text-[14px] font-medium">{{ t('public.rankings.emptyTitle') }}</p>
      <p class="mt-1 text-[13px] text-fg-subtle">{{ t('public.rankings.emptyDesc') }}</p>
    </div>

    <div v-else class="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <!-- 模型榜 -->
      <div>
        <h2 class="text-[20px] font-semibold tracking-tight">
          {{ t('public.rankings.modelBoard') }}
        </h2>
        <div
          class="mt-4 divide-y divide-border overflow-hidden rounded-[16px] border border-border bg-bg-elevated"
        >
          <div
            v-for="m in models"
            :key="m.model_name"
            class="flex items-center gap-4 px-5 py-3.5"
          >
            <span class="w-7 shrink-0 text-center text-[15px] font-semibold tabular">
              {{ m.rank }}
            </span>

            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <p class="truncate font-mono text-[13.5px] font-medium">
                  {{ m.model_name }}
                </p>
                <span class="shrink-0 text-[12px] text-fg-subtle">{{ m.vendor }}</span>
              </div>
              <!-- 占比条 -->
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-inset">
                <div
                  class="h-full rounded-full bg-brand"
                  :style="{ width: `${Math.max(m.share * 100, 1.5)}%` }"
                />
              </div>
            </div>

            <div class="shrink-0 text-right">
              <p class="text-[13.5px] font-medium tabular">
                {{ formatPercent(m.share) }}
              </p>
              <p class="text-[11.5px] text-fg-subtle">
                {{ formatCompact(m.total_tokens) }} tokens
              </p>
            </div>

            <span
              class="flex w-12 shrink-0 items-center justify-end gap-0.5 text-[12px] tabular"
              :class="
                rankDelta(m).kind === 'up'
                  ? 'text-success-fg'
                  : rankDelta(m).kind === 'down'
                    ? 'text-danger-fg'
                    : 'text-fg-subtle'
              "
            >
              <template v-if="rankDelta(m).kind === 'new'">NEW</template>
              <template v-else-if="rankDelta(m).kind === 'up'">
                <TrendingUp class="size-3.5" />{{ rankDelta(m).n }}
              </template>
              <template v-else-if="rankDelta(m).kind === 'down'">
                <TrendingDown class="size-3.5" />{{ rankDelta(m).n }}
              </template>
              <template v-else><Minus class="size-3.5" /></template>
            </span>
          </div>
        </div>
        <p class="mt-3 text-[12.5px] text-fg-subtle">
          {{ t('public.rankings.note') }}
        </p>
      </div>

      <!-- 右栏：厂商榜 + 涨跌 -->
      <aside class="space-y-8">
        <div v-if="vendors.length">
          <h2 class="text-[20px] font-semibold tracking-tight">
            {{ t('public.rankings.vendorBoard') }}
          </h2>
          <div
            class="mt-4 divide-y divide-border overflow-hidden rounded-[16px] border border-border bg-bg-elevated"
          >
            <div
              v-for="v in vendors"
              :key="v.vendor"
              class="flex items-center gap-3 px-4 py-3"
            >
              <span class="w-5 shrink-0 text-center text-[13.5px] font-semibold tabular">
                {{ v.rank }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13.5px] font-medium">{{ v.vendor }}</p>
                <p class="text-[11.5px] text-fg-subtle">
                  {{ t('public.rankings.vendorMeta', { n: v.models_count, top: v.top_model }) }}
                </p>
              </div>
              <span class="shrink-0 text-[13px] font-medium tabular">
                {{ formatPercent(v.share) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="movers.length">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('public.rankings.movers') }}
          </h2>
          <ul
            class="mt-3 divide-y divide-border overflow-hidden rounded-[16px] border border-border bg-bg-elevated"
          >
            <li
              v-for="m in movers"
              :key="m.model_name"
              class="flex items-center gap-3 px-4 py-2.5"
            >
              <TrendingUp class="size-4 shrink-0 text-success-fg" />
              <p class="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                {{ m.model_name }}
              </p>
              <span class="shrink-0 text-[12px] tabular text-success-fg">
                +{{ m.rank_delta }}
              </span>
            </li>
          </ul>
        </div>

        <div v-if="droppers.length">
          <h2 class="text-[16px] font-semibold tracking-tight">
            {{ t('public.rankings.droppers') }}
          </h2>
          <ul
            class="mt-3 divide-y divide-border overflow-hidden rounded-[16px] border border-border bg-bg-elevated"
          >
            <li
              v-for="m in droppers"
              :key="m.model_name"
              class="flex items-center gap-3 px-4 py-2.5"
            >
              <TrendingDown class="size-4 shrink-0 text-danger-fg" />
              <p class="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                {{ m.model_name }}
              </p>
              <span class="shrink-0 text-[12px] tabular text-danger-fg">
                {{ m.rank_delta }}
              </span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>
