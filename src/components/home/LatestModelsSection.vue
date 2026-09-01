<script setup lang="ts">
/**
 * 最新模型区块 —— infron.ai y5848，CDP 实测：
 *
 *   区块      padding 100px 20px，宽 1100
 *   眉标      18px/600 #3F3AD4；标题 42px/600 lh 50.4px ls -0.84px
 *   卡片      340×363，radius 24px，padding 24px，列间距 24px（3 列）
 *   发布日    14px/400 lh 19.6px #999，日期 ls 1.26px
 *   模型名    24px/600 lh 33.6px #38383D
 *   价格标签  16px/400 lh 22.4px #737373；价格 20px/600 lh28 ls 0.6px
 *   类型徽章  13px/400 lh 15.6px rgba(0,0,0,.65)
 *
 * 数据来自后端 /api/models，不是硬编码列表 —— 首页展示的模型和价格
 * 必须跟实际能调用的一致，否则就是虚假宣传。列表为空时整块不渲染。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'

export interface ModelCard {
  id: string
  /** 模型名，取后端 model_name */
  name: string
  /** 厂商名，由 vendor_id 查 vendors 得到；未知时为 null */
  vendor?: string | null
  /** 能力标签，如「对话」「绘画」 */
  tag?: string | null
  /** 每百万 token 输入价，单位美元 */
  inputPrice?: number | null
  /** 每百万 token 输出价，单位美元 */
  outputPrice?: number | null
  /** 按次计费模型的单次价格，单位美元；与上面两个字段互斥 */
  perCallPrice?: number | null
}

const props = withDefaults(
  defineProps<{ models?: ModelCard[]; limit?: number }>(),
  { models: () => [], limit: 6 },
)

const { t } = useI18n()

const shown = computed(() => props.models.slice(0, props.limit))

/**
 * 价格缺失时显示占位符，不显示 $0.00 —— 会被读成「免费」。
 * 小于 $0.01 的按 4 位小数展示，否则廉价模型会全部显示成 $0.00。
 */
function price(v?: number | null): string {
  if (typeof v !== 'number') return '—'
  return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}/M`
}

function perCall(v?: number | null): string {
  return typeof v === 'number' ? `$${v.toFixed(3)}` : '—'
}
</script>

<template>
  <section v-if="shown.length" class="px-5 py-[100px]">
    <div class="mx-auto max-w-[1400px]">
      <p class="text-[18px] font-semibold leading-[21.6px] text-brand">
        {{ t('home.latest.eyebrow') }}
      </p>
      <h2
        class="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.84px] lg:text-[42px] lg:leading-[50.4px]"
      >
        {{ t('home.latest.title') }}
      </h2>

      <ul class="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <li
          v-for="m in shown"
          :key="m.id"
          class="motion-lift flex flex-col rounded-[24px] border border-border bg-bg-elevated p-6 hover:shadow-lg"
        >
          <p
            v-if="m.vendor"
            class="text-[14px] leading-[19.6px] text-fg-subtle"
          >
            {{ m.vendor }}
          </p>

          <h3
            class="mt-2 break-words text-[24px] font-semibold leading-[33.6px] text-fg-secondary"
          >
            {{ m.name }}
          </h3>

          <!-- 按 token 计费：入/出双价；按次计费：单价一行 -->
          <dl v-if="m.perCallPrice == null" class="mt-6 space-y-2">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[16px] leading-[22.4px] text-fg-muted">
                {{ t('home.latest.inputPrice') }}
              </dt>
              <dd class="text-[20px] font-semibold leading-7 tracking-[0.6px] text-fg-secondary">
                {{ price(m.inputPrice) }}
              </dd>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[16px] leading-[22.4px] text-fg-muted">
                {{ t('home.latest.outputPrice') }}
              </dt>
              <dd class="text-[20px] font-semibold leading-7 tracking-[0.6px] text-fg-secondary">
                {{ price(m.outputPrice) }}
              </dd>
            </div>
          </dl>

          <dl v-else class="mt-6">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-[16px] leading-[22.4px] text-fg-muted">
                {{ t('home.latest.perCall') }}
              </dt>
              <dd class="text-[20px] font-semibold leading-7 tracking-[0.6px] text-fg-secondary">
                {{ perCall(m.perCallPrice) }}
              </dd>
            </div>
          </dl>

          <div class="mt-auto flex flex-wrap gap-2 pt-6">
            <span
              v-if="m.tag"
              class="w-fit rounded-full bg-bg-muted px-2.5 pb-1 pt-[5px] text-[13px] leading-[15.6px] text-fg/65"
            >
              {{ m.tag }}
            </span>
            <span
              class="w-fit rounded-full bg-bg-muted px-2.5 pb-1 pt-[5px] text-[13px] leading-[15.6px] text-fg/65"
            >
              {{ m.perCallPrice == null ? t('home.latest.kindToken') : t('home.latest.kindCall') }}
            </span>
          </div>
        </li>
      </ul>

      <div class="mt-12 flex justify-center">
        <RouterLink
          to="/models"
          class="motion-press group inline-flex h-10 items-center gap-2 rounded-[100px] border border-border-strong px-[18px] text-[14px] tracking-[-0.14px] hover:bg-bg-muted"
        >
          {{ t('home.latest.cta') }}
          <ArrowRight class="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </RouterLink>
      </div>
    </div>
  </section>
</template>
