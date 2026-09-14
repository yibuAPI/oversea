/**
 * vue3-beautiful-chat 没有自带类型（package.json 里没有 types/typings 字段），
 * 而本项目开了 strict + noImplicitAny，没有这份声明连 import 都过不去。
 *
 * 这里只声明我们实际用到的子集：默认导出是 Vue 插件，install 时注册一个全局组件
 * "BeautifulChat"，所以模板里直接写 <BeautifulChat> 即可。props 清单来自
 * dist/vue3-beautiful-chat.esm.js 里的 props 定义。
 */
declare module 'vue3-beautiful-chat' {
  import type { DefineComponent } from 'vue'

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

  export interface ChatComponentProps {
    participants: ChatParticipant[]
    messageList: ChatMessage[]
    /** 必填，组件内部当默认值兜底，不给会 warn */
    placeholder?: string
    showTypingIndicator?: string
    colors?: Partial<ChatColors>
    isOpen?: boolean
    title?: string
    titleImageUrl?: string
    showEmoji?: boolean
    showFile?: boolean
    showEdition?: boolean
    showDeletion?: boolean
    showTypingIndicatorSwitch?: boolean
    showLauncher?: boolean
    showCloseButton?: boolean
    showMinimizeButton?: boolean
    alwaysScrollToBottom?: boolean
    messageStyling?: boolean
    disableUserListToggle?: boolean
    acceptedFileTypes?: string[]
    messageMargin?: { top?: number; bottom?: number; left?: number; right?: number }
    icons?: Record<string, unknown>
    onMessageWasSent?: (message: ChatMessage) => void
    close?: () => void
    minimize?: () => void
    open?: () => void
  }

  /**
   * 默认导出在库内被同时当作插件（app.use）和组件（模板里的 <BeautifulChat>）。
   * 只按 Plugin 声明的话，模板里用它会报缺 version/config/use 之类的错 ——
   * 这里按组件声明，插件用法我们不使用。
   */
  const VueBeautifulChat: DefineComponent<ChatComponentProps>
  export default VueBeautifulChat
}
