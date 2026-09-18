<script setup lang="ts">
/**
 * 特性区配图 —— 纯 CSS/SVG 绘制的产品示意，不用外部图片。
 *
 * 四种示意各自对应一个特性：
 *   code      统一接口 —— 一段真实可跑的调用代码
 *   failover  稳定可靠 —— 多渠道容灾拓扑 + 探测日志
 *   price     价格透明 —— 用量占比与本月账单
 *   support   技术支持 —— 工单响应时间线
 *
 * 四张图共用同一套窗口 chrome（顶部 44px 标题条 + 内容区），
 * 这样四段横向扫下来是一套界面，不是四张风格各异的插画。
 *
 * 尺寸 494×494 与 infron 实测一致；内容必须撑满，
 * 上下留一大片空白正是「廉价感」的来源。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{ kind: 'code' | 'failover' | 'price' | 'support' }>()

const { t } = useI18n()

/** 用量占比：相对比例示意，不标绝对金额，避免被当成报价 */
const usage = [
  { label: 'gpt-5-chat-latest', pct: 82 },
  { label: 'claude-sonnet-5', pct: 64 },
  { label: 'deepseek-r1', pct: 41 },
  { label: 'qwen3.5-plus', pct: 28 },
  { label: 'glm-4.6', pct: 17 },
]

/**
 * 渠道状态、探测时间戳、时间线刻度都是示意数据，不随语言变；文案走 i18n。
 * 三个列表必须是 computed —— 顶层 const 只求值一次，切语言不会重新取文案。
 */
const CHANNEL_STATES = ['down', 'up', 'idle'] as const
const channels = computed(() =>
  CHANNEL_STATES.map((state, i) => ({
    state,
    name: t(`home.features.visual.failover.channels.${i}.name`),
    note: t(`home.features.visual.failover.channels.${i}.note`),
  })),
)

/** 健康探测日志：与上面的渠道状态一一对应，读起来是同一件事 */
const PROBE_TIMES = ['12:04:31', '12:04:31', '12:04:31']
const probes = computed(() =>
  PROBE_TIMES.map((time, i) => ({
    t: time,
    s: t(`home.features.visual.failover.probes.${i}`),
  })),
)

const TIMELINE_TIMES = ['00:00', '00:04', '00:09', '00:12']
const timeline = computed(() =>
  TIMELINE_TIMES.map((time, i) => ({
    t: time,
    title: t(`home.features.visual.support.timeline.${i}.title`),
    s: t(`home.features.visual.support.timeline.${i}.s`),
  })),
)
</script>

<template>
  <div
    class="flex size-full flex-col overflow-hidden rounded-[24px] border border-border bg-bg-elevated"
  >
    <!-- ============ 统一接口：真实调用代码 ============ -->
    <template v-if="kind === 'code'">
      <div class="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
        <span class="size-2.5 rounded-full bg-[#ff5f57]" />
        <span class="size-2.5 rounded-full bg-[#febc2e]" />
        <span class="size-2.5 rounded-full bg-[#28c840]" />
        <span class="ml-2 font-mono text-xs text-fg-subtle">main.py</span>
      </div>
      <pre
        class="flex-1 overflow-hidden px-5 py-6 font-mono text-[12.5px] leading-[1.85] text-fg-muted"
      ><code><span class="text-fg-subtle">{{ t('home.features.visual.code.comment') }}</span>
<span class="text-brand">from</span> openai <span class="text-brand">import</span> OpenAI

client = OpenAI(
    base_url=<span class="text-success-fg">"https://api.example.com/v1"</span>,
    api_key=<span class="text-success-fg">"sk-..."</span>,
)

resp = client.chat.completions.create(
    model=<span class="text-success-fg">"gpt-5-chat-latest"</span>,
    messages=[{<span class="text-success-fg">"role"</span>: <span class="text-success-fg">"user"</span>,
                <span class="text-success-fg">"content"</span>: <span class="text-success-fg">"{{ t('home.features.visual.code.hello') }}"</span>}],
)
print(resp.choices[<span class="text-warning-fg">0</span>].message.content)</code></pre>
      <div
        class="flex shrink-0 items-center justify-between border-t border-border px-5 py-3.5 font-mono text-[12px]"
      >
        <span class="text-fg-subtle">$ python main.py</span>
        <span class="text-success-fg">200 OK · 428ms</span>
      </div>
    </template>

    <!-- ============ 稳定可靠：多渠道容灾 ============ -->
    <template v-else-if="kind === 'failover'">
      <div
        class="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5"
      >
        <span class="text-[13px] font-medium">{{ t('home.features.visual.failover.title') }}</span>
        <span class="flex items-center gap-1.5 text-[12px] text-success-fg">
          <span class="size-1.5 rounded-full bg-success-fg" />
          {{ t('home.features.visual.failover.enabled') }}
        </span>
      </div>

      <div class="flex flex-1 flex-col justify-center gap-3 px-5 py-5">
        <div class="rounded-xl border border-border bg-bg-subtle px-4 py-3 text-center">
          <p class="text-[14px] font-medium">{{ t('home.features.visual.failover.request') }}</p>
        </div>

        <div class="flex justify-center text-border-strong">
          <svg width="20" height="18" viewBox="0 0 20 18" fill="none" aria-hidden="true">
            <path
              d="M10 0v13m0 0l-5-5m5 5l5-5"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
        </div>

        <ul class="space-y-2.5">
          <li
            v-for="c in channels"
            :key="c.name"
            class="flex items-center justify-between rounded-xl border px-4 py-3"
            :class="
              c.state === 'down'
                ? 'border-danger-border bg-danger-bg'
                : c.state === 'up'
                  ? 'border-success-border bg-success-bg'
                  : 'border-border bg-bg-subtle'
            "
          >
            <span class="font-mono text-[12.5px]">{{ c.name }}</span>
            <span
              class="text-[12px]"
              :class="
                c.state === 'down'
                  ? 'text-danger-fg'
                  : c.state === 'up'
                    ? 'text-success-fg'
                    : 'text-fg-subtle'
              "
            >
              {{ c.note }}
            </span>
          </li>
        </ul>
      </div>

      <!-- 探测日志：把上面的状态变化写成时间序列，图不再是静态摆拍 -->
      <ul class="shrink-0 border-t border-border px-5 py-4 font-mono text-[11.5px]">
        <li
          v-for="p in probes"
          :key="p.s"
          class="flex gap-3 py-[3px] text-fg-subtle"
        >
          <span class="shrink-0">{{ p.t }}</span>
          <span class="truncate">{{ p.s }}</span>
        </li>
      </ul>
    </template>

    <!-- ============ 价格透明：用量占比 ============ -->
    <template v-else-if="kind === 'price'">
      <div
        class="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5"
      >
        <span class="text-[13px] font-medium">{{ t('home.features.visual.price.title') }}</span>
        <span class="font-mono text-[12px] text-fg-subtle">2026-07</span>
      </div>

      <div class="flex flex-1 flex-col justify-center gap-5 px-5 py-5">
        <div v-for="u in usage" :key="u.label" class="space-y-2">
          <div class="flex items-baseline justify-between">
            <span class="font-mono text-[12.5px] text-fg-muted">{{ u.label }}</span>
            <span class="text-[12.5px] tabular-nums text-fg-subtle">{{ u.pct }}%</span>
          </div>
          <div class="h-2.5 overflow-hidden rounded-full bg-bg-inset">
            <div
              class="h-full rounded-full bg-brand"
              :style="{ width: `${u.pct}%` }"
            />
          </div>
        </div>
      </div>

      <div class="shrink-0 border-t border-border px-5 py-4">
        <div class="flex items-baseline justify-between">
          <span class="text-[13px] text-fg-muted">{{ t('home.features.visual.price.settlement') }}</span>
          <span class="text-[13px] font-medium">{{ t('home.features.visual.price.noFee') }}</span>
        </div>
      </div>
    </template>

    <!-- ============ 技术支持：响应时间线 ============ -->
    <template v-else>
      <div
        class="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5"
      >
        <span class="text-[13px] font-medium">{{ t('home.features.visual.support.ticket') }}</span>
        <span
          class="rounded-full bg-success-bg px-2.5 py-1 text-[11.5px] text-success-fg"
        >
          {{ t('home.features.visual.support.resolved') }}
        </span>
      </div>

      <div class="flex flex-1 flex-col justify-center px-5 py-5">
        <div v-for="(item, i) in timeline" :key="item.t" class="flex gap-4">
          <div class="flex flex-col items-center">
            <span
              class="grid size-7 shrink-0 place-items-center rounded-full text-[11.5px] font-medium"
              :class="
                i === timeline.length - 1
                  ? 'bg-success-bg text-success-fg'
                  : 'bg-accent-bg text-accent'
              "
            >
              {{ i + 1 }}
            </span>
            <span
              v-if="i < timeline.length - 1"
              class="my-1 w-px flex-1 bg-border"
            />
          </div>
          <div :class="i < timeline.length - 1 ? 'pb-5' : ''">
            <div class="flex items-baseline gap-2.5">
              <span class="font-mono text-[11.5px] text-fg-subtle">{{ item.t }}</span>
              <span class="text-[14px] font-medium">{{ item.title }}</span>
            </div>
            <p class="mt-1 text-[13px] leading-[1.55] text-fg-muted">{{ item.s }}</p>
          </div>
        </div>
      </div>

      <div class="shrink-0 border-t border-border px-5 py-4">
        <div class="flex items-baseline justify-between">
          <span class="text-[13px] text-fg-muted">{{ t('home.features.visual.support.firstResponse') }}</span>
          <span class="text-[13px] font-medium tabular-nums">{{ t('home.features.visual.support.firstResponseValue') }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
