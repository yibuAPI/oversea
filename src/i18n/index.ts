import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

const STORAGE_KEY = 'onestep-locale'
export const SUPPORTED = ['zh-CN', 'en'] as const
export type Locale = (typeof SUPPORTED)[number]

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (SUPPORTED as readonly string[]).includes(saved)) {
      return saved as Locale
    }
  } catch {
    /* localStorage 不可用时用默认语言 */
  }
  // 海外站默认英文：不跟随 navigator.language，中文浏览器打开也先给英文，
  // 手动切过中文的用户由上面的 localStorage 分支保留偏好。
  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: detect(),
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en },
})

export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    /* 忽略 */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}
