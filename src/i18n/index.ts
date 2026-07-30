import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

const STORAGE_KEY = 'yibu-locale'
export const SUPPORTED = ['zh-CN', 'en'] as const
export type Locale = (typeof SUPPORTED)[number]

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (SUPPORTED as readonly string[]).includes(saved)) {
      return saved as Locale
    }
  } catch {
    /* localStorage 不可用时回落浏览器语言 */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN'
  return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: detect(),
  fallbackLocale: 'zh-CN',
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
