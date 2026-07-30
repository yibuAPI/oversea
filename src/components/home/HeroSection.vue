<script setup lang="ts">
/**
 * Hero —— 全部尺寸取自 infron.ai 线上真实计算样式（CDP 实测，非目测）：
 *
 *   section     高 700px 固定，非自适应
 *   内容左边距   120px
 *   标题        60px / line-height 66px / letter-spacing -1.2px / weight 400 / 纯黑
 *   副标题      16px / line-height 22.4px / 宽 650px / #38383D
 *   按钮        高 40px，主按钮 radius 20px + padding 8px 8px 8px 18px
 *                        次按钮 radius 100px + padding 8px 18px，间距 12px
 *   渐变图      x489 y-95 w936 h799，object-position 0% 100%
 *
 * 标题是 weight 400 不是 600 —— 这是之前观感偏差的主因之一。
 *
 * 渐变图的宽屏行为按 1878px 实测 infron 复核：
 *   1418px 下  x489 w936  → 右边缘 1425（≈贴右）
 *   1878px 下  x646 w1239 → 右边缘 1885（≈贴右，溢出 7px）
 * 即它不是定宽块，而是「左边缘按视口比例定位（489/1418 ≈ 646/1878 ≈ 34.4%）
 * ＋ 右侧一路铺到视口边缘」。照抄 left-489/w-936 的定值，
 * 在宽屏下右边会露出一条白 —— 渐变必须到顶。
 * 故改成 left-[34.4%] + right-0，宽度由两端撑开，
 * 高度同比放大（799/1418 ≈ 56.4%，用 aspect 无法表达，直接给 min-h）。
 *
 * 宽屏行为按 1878px 实测 infron 复核：h1 仍在 x120。
 * 即 hero 是贴视口左侧的，不随正文（1100 居中）一起居中 ——
 * 这是 infron 刻意的「头部/hero 通栏 + 正文居中」混合布局。
 * 曾把 hero 套进居中容器，属于自作主张，已改回实测值。
 */
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ArrowRight } from 'lucide-vue-next'

const { t } = useI18n()
</script>

<template>
  <section class="relative h-[700px] overflow-hidden">
    <div class="relative h-full">
      <!--
        渐变视觉块：左边缘按视口 34.4% 定位，右侧铺到边（right-0），
        向上溢出 95px，底部对齐取图（object-position 0% 100%）
      -->
      <div
        class="pointer-events-none absolute bottom-0 left-[34.4%] right-0 top-[-95px] hidden lg:block"
        aria-hidden="true"
      >
        <!-- 暗色下反相再转回色相：白→黑融入底色，蓝仍是蓝，
             比单纯压透明度（一片浑浊的灰）观感好得多 -->
        <img
          src="/hero-gradient.png"
          alt=""
          class="size-full object-cover object-[0%_100%] dark:invert dark:hue-rotate-180"
        />
      </div>

      <div class="relative h-full px-6 lg:px-0">
        <!-- 左边距与 SiteHeader 的 logo 同一套断点，两者必须同进同出 -->
        <div class="pt-[180px] lg:pl-10 lg:pt-[260px] xl:pl-[120px]">
          <h1
            class="max-w-[840px] text-[40px] font-normal leading-[1.1] tracking-[-0.02em] text-fg sm:text-[52px] lg:text-[60px] lg:leading-[66px] lg:tracking-[-1.2px]"
          >
            {{ t('home.hero.line1') }}<br />{{ t('home.hero.line2') }}
          </h1>

          <p
            class="mt-[20px] max-w-[650px] text-[16px] leading-[22.4px] text-fg-secondary"
          >
            {{ t('home.hero.subtitle') }}
          </p>

          <div class="mt-[70px] flex flex-wrap items-center gap-3">
            <RouterLink
              to="/console"
              class="group inline-flex h-10 items-center gap-2.5 rounded-[20px] bg-btn-primary-bg py-2 pl-[18px] pr-2 text-[16px] font-normal text-btn-primary-fg transition-opacity hover:opacity-88"
            >
              {{ t('home.hero.primaryCta') }}
              <span
                class="grid size-6 shrink-0 place-items-center rounded-full bg-btn-primary-fg/15 transition-transform group-hover:translate-x-0.5"
              >
                <ArrowRight class="size-3.5" />
              </span>
            </RouterLink>

            <RouterLink
              to="/models"
              class="inline-flex h-10 items-center rounded-[100px] border border-border-strong px-[18px] py-2 text-[16px] font-normal transition-colors hover:bg-bg-muted"
            >
              {{ t('home.hero.secondaryCta') }}
            </RouterLink>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
