<script setup lang="ts">
/**
 * 厂商 logo 滚动行 —— hero 左栏内嵌的一排白色圆角小卡片。
 * 「500+」小标签不在这里，由 NewHeroSection 单独渲染；
 * 本组件只负责那排卡片本身，并接受外部的 class（如 mt-14 上边距）。
 *
 * 复用 TrustedBySection 同款滚动：重复列表 translateX(-50%) 无缝循环
 * + 两翼 mask 渐隐。最左固定一张「···」更多入口，不参与滚动。
 *
 * 交互（对齐参考站）：鼠标进入滚动区整条暂停，方便看清/点中某个 logo；
 * 单卡 hover 上浮 + 紫色描边 + 柔光，logo 本身再放大一点。
 * 暂停用 animation-play-state 而不是停掉 animation ——
 * 后者会把 transform 归零，整排瞬间弹回起点。
 *
 * vendors 形如 [{ src: '/vendors/openai.png', name: 'OpenAI' }]：
 * src 是本地/公网图片路径，直接 <img> 加载；name 作 alt/aria。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { MoreHorizontal } from 'lucide-vue-next'

export interface VendorLogo {
  /** 图片地址，如 '/vendors/openai.png'（public/ 下的本地厂商标） */
  src: string
  /** 展示名，作 alt / aria-label */
  name: string
}

const props = withDefaults(
  defineProps<{
    vendors?: VendorLogo[]
  }>(),
  { vendors: () => [] },
)

const { t } = useI18n()
const marquee = computed(() => [...props.vendors, ...props.vendors])

/** 「···」入口与滚动卡片同款外观，hover 效果统一写在 .logo-card 里 */
const cardCls =
  'logo-card grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl ' +
  'border border-border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-neutral-700'
</script>

<template>
  <div v-if="vendors.length" class="flex items-stretch gap-3">
    <!-- 固定「···」更多入口：不滚动，但同样有 hover 上浮 -->
    <RouterLink
      to="/models"
      :class="cardCls"
      :aria-label="t('homeNew.models.more')"
    >
      <MoreHorizontal class="size-5 text-fg-muted" />
    </RouterLink>

    <!-- 滚动行：两翼 mask 渐隐，重复列表匀速左移。
         鼠标进入滚动区整条暂停，便于看清 / 点中某个 logo。 -->
    <div
      class="marquee-hover relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]"
    >
      <ul
        class="marquee flex w-max items-stretch gap-3"
        :aria-label="t('homeNew.models.title')"
      >
        <li
          v-for="(v, i) in marquee"
          :key="`${v.name}-${i}`"
          class="shrink-0"
          :aria-hidden="i >= vendors.length"
        >
          <RouterLink
            to="/models"
            :class="cardCls"
            :aria-label="i < vendors.length ? v.name : ''"
          >
            <img
              :src="v.src"
              :alt="v.name"
              class="logo-mark size-6 object-contain"
              loading="lazy"
            />
          </RouterLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.marquee {
  animation: marquee-scroll 38s linear infinite;
}
@keyframes marquee-scroll {
  to {
    transform: translateX(-50%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .marquee {
    animation: none;
  }
}

/* 鼠标进入滚动区，整排暂停。用 play-state 而非停掉 animation ——
   后者会取消 transform，整排瞬间弹回起点。 */
.marquee-hover:hover .marquee {
  animation-play-state: paused;
}

/* 单卡 hover：上浮 + 紫色描边 + 柔光；logo 自身再放大一档。 */
.logo-card {
  transition-property: background-color, border-color, box-shadow, transform;
  transition-timing-function: var(--ease-out);
  transition-duration: var(--duration-base);
}
.logo-card:hover {
  transform: translateY(-3px);
  border-color: var(--hero-purple);
  box-shadow:
    0 8px 20px -6px rgba(76, 29, 149, 0.28),
    0 0 0 1px rgba(139, 92, 246, 0.35);
}
.logo-card:hover .logo-mark {
  transform: scale(1.14);
}
.logo-card .logo-mark {
  transition: transform var(--duration-base) var(--ease-out);
}
</style>
