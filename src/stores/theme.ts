import { defineStore } from 'pinia'
import { ref, computed, watchEffect } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'onestep-theme'

/**
 * 主题。index.html 的内联脚本已在首屏前套用过一次以避免闪烁（FOUC），
 * 此 store 负责其后的切换与持久化，两处的 storage key 必须一致。
 *
 * 默认浅色而非跟随系统：落地页的视觉是按浅色设计的，跟随系统会让深色
 * 系统的访客第一眼看到完全另一套观感。用户手动切换后仍然持久化。
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored())
  const systemDark = ref(prefersDark())

  function readStored(): ThemeMode {
    try {
      const v = localStorage.getItem(STORAGE_KEY)
      return v === 'light' || v === 'dark' || v === 'system' ? v : 'light'
    } catch {
      return 'light'
    }
  }

  function prefersDark() {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    )
  }

  if (typeof window !== 'undefined') {
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', (e) => (systemDark.value = e.matches))
  }

  const isDark = computed(() =>
    mode.value === 'system' ? systemDark.value : mode.value === 'dark',
  )

  watchEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', isDark.value)
    document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light'
  })

  function setMode(next: ThemeMode) {
    mode.value = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* 隐私模式下 localStorage 不可用，忽略 */
    }
  }

  function toggle() {
    setMode(isDark.value ? 'light' : 'dark')
  }

  return { mode, isDark, setMode, toggle }
})
