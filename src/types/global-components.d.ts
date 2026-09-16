/**
 * 把"运行时由插件注册的全局组件"告诉 vue-tsc。
 *
 * 这里的 `declare module 'vue'` 是**增补**（module augmentation），不是声明 ——
 * 因为本文件有顶层 import，是模块。区别很关键：在非模块文件里写
 * `declare module 'vue'` 会把整个 vue 模块重新声明一遍，等于把所有导出
 * （ref / computed / onMounted ...）全抹掉，全项目报 TS2305。
 *
 * 组件本身由 vue3-beautiful-chat 的插件在 install() 里
 * `app.component('BeautifulChat', ...)` 注册，见 src/main.ts。
 */
import type { DefineComponent } from 'vue'
import type { ChatComponentProps } from 'vue3-beautiful-chat'

declare module 'vue' {
  export interface GlobalComponents {
    BeautifulChat: DefineComponent<ChatComponentProps>
  }
}
