<script setup lang="ts">
/**
 * 客户 logo 条 —— 左侧 "Trusted by" 标签 + 右侧无缝滚动跑马灯。
 * 结构与动效参照 infron.ai：translateX 匀速位移、列表复制一份实现无缝循环、
 * 两端渐隐遮罩。
 *
 * logos 为空时整个区块不渲染 —— 客户名单必须是真实的，
 * 没有素材就不占位，绝不拿别家的客户充数。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    /** 客户 logo：src 为图片地址，alt 为客户名 */
    logos?: { src: string; alt: string }[]
  }>(),
  { logos: () => [] },
)

const { t } = useI18n()

/** 复制一份用于无缝衔接：位移 -50% 时正好接回起点 */
const marquee = computed(() => [...props.logos, ...props.logos])
</script>

<template>
  <section v-if="logos.length" class="bg-bg py-16">
    <div
      class="flex flex-col gap-8 px-6 lg:flex-row lg:items-center lg:gap-14 lg:px-[120px]"
    >
      <p class="shrink-0 text-[24px] font-semibold leading-[31.2px]">
        {{ t('home.trustedBy') }}
      </p>

      <!-- 两端渐隐：用遮罩而非叠色块，深浅主题下都干净 -->
      <div
        class="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_6%,#000_94%,transparent)]"
      >
        <ul class="marquee flex w-max items-center gap-[76px]">
          <li
            v-for="(logo, i) in marquee"
            :key="`${logo.alt}-${i}`"
            class="shrink-0"
            :aria-hidden="i >= logos.length"
          >
            <img
              :src="logo.src"
              :alt="i < logos.length ? logo.alt : ''"
              class="h-10 w-auto object-contain"
              loading="lazy"
            />
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.marquee {
  animation: marquee-scroll 38s linear infinite;
}

/* 复制了一份列表，位移一半即无缝循环 */
@keyframes marquee-scroll {
  to {
    transform: translateX(-50%);
  }
}

/* 尊重系统的减少动效偏好 */
@media (prefers-reduced-motion: reduce) {
  .marquee {
    animation: none;
  }
}
</style>
