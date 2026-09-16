/**
 * vue3-beautiful-chat 没有自带类型（package.json 里没有 types/typings 字段），
 * 而本项目开了 strict + noImplicitAny，没有这份声明连 import 都过不去。
 *
 * ⚠️ 默认导出是 **Vue 插件**，不是组件：
 *
 *     const ft = {
 *       install(app) {
 *         app.config.globalProperties.$event = <事件总线>
 *         app.component('BeautifulChat', <真正的窗口组件>)
 *       }
 *     }
 *     export { ft as default }
 *
 * 包内也没有导出那个窗口组件（dist 里只有这一个 export），所以拿组件的唯一途径
 * 就是在 main.ts 里 `app.use(BeautifulChat)`，然后模板中用全局注册名
 * <BeautifulChat> —— 全局组件名由 install 里 `app.component(this.componentName, ...)`
 * 注册，componentName 可用 app.use 的第二参数覆盖，这里是默认值。
 *
 * 因此本文件做两件事：把默认导出声明成 Plugin，并把 "BeautifulChat" 注册进
 * 全局组件表，让 vue-tsc 在模板里认得出它。props 清单来自
 * dist/vue3-beautiful-chat.esm.js 里的 props 定义。
 */
declare module 'vue3-beautiful-chat' {
  import type { DefineComponent, Plugin } from 'vue'

  /** 一条气泡。author 为 "me" 时渲染在右侧（已发送），system 类型居中显示。 */
  export interface ChatMessage {
    id?: string | number
    author: string
    type?: 'text' | 'system' | 'typing' | 'file'
    data?: {
      text?: string
      meta?: string
      file?: { name: string; type: string; size?: number; url?: string; base64?: string }
    }
    /** 系统消息（type: "system"）在气泡里额外显示的说明行 */
    meta?: string
    /** 仅类型层面透传，组件内部不读 */
    timestamp?: string
  }

  /** 左上角的聊天对象（头像 + 名字），me 用来决定哪一侧是"自己" */
  export interface ChatParticipant {
    id: string
    name: string
    imageUrl?: string
    style?: Record<string, string>
  }

  export interface ChatColors {
    header: { bg: string; text: string }
    launcher: { bg: string }
    messageList: { bg: string }
    sentMessage: { bg: string; text: string }
    receivedMessage: { bg: string; text: string }
    userInput: { bg: string; text: string }
    emojiPicker?: { bg?: string; text?: string }
  }

  /**
   * 窗口组件的 props。required 的几项是按库内 `required: !0` 抄的，
   * 缺了会打 Vue warn（不影响功能，但控制台会脏）：
   * isOpen / open / close / participants / onMessageWasSent。
   */
  export interface ChatComponentProps {
    participants: ChatParticipant[]
    messageList: ChatMessage[]
    placeholder?: string
    showTypingIndicator?: string
    colors?: Partial<ChatColors>
    isOpen: boolean
    open: () => void
    close: () => void
    onMessageWasSent: (message: ChatMessage) => void
    title?: string
    titleImageUrl?: string
    showEmoji?: boolean
    showFile?: boolean
    showEdition?: boolean
    showDeletion?: boolean
    showLauncher?: boolean
    showCloseButton?: boolean
    showMinimizeButton?: boolean
    showHeader?: boolean
    alwaysScrollToBottom?: boolean
    messageStyling?: boolean
    disableUserListToggle?: boolean
    newMessagesCount?: number
    acceptedFileTypes?: string[]
    messageMargin?: { top?: number; bottom?: number; left?: number; right?: number }
    icons?: Record<string, unknown>
    minimize?: () => void
  }

  /** install 时被 app.component("BeautifulChat", ...) 注册的窗口组件 */
  const BeautifulChatWindow: DefineComponent<ChatComponentProps>

  /**
   * 默认导出是插件。用法固定为 main.ts 里的 `app.use(BeautifulChat)`，
   * 组件从全局注册名拿 —— 不要 import 它当组件用在模板里。
   */
  const VueBeautifulChatPlugin: Plugin
  export default VueBeautifulChatPlugin
}

/*
 * 注意：本文件刻意保持为"全局脚本"（只有 ambient 声明，没有顶层 import/export）。
 * 因为 vue3-beautiful-chat 是个不带类型的 JS 包，上面那个 declare module 是
 * 从零**声明**这个模块；一旦本文件变成模块（加了 import/export），该语句就会
 * 被当成"增补"，而对方没有类型可增补，声明直接失效。
 *
 * 所以注册全局组件的那份 vue 模块增补放在 global-components.d.ts 里，不在本文件。
 */
