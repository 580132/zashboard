import { useStorage } from '@/composables/use-storage'
import { ref } from 'vue'

export const logFilter = ref('')
export const logTypeFilter = ref('')
export const logFilterRegex = useStorage<string>('config/log-filter-regex', '')
export const logFilterEnabled = useStorage<boolean>('config/log-filter-enabled', false)

// ANSI 颜色码。base 的 helper/ansi.ts 已被上游删除,这里内联最小子集(SGR 码),
// 足以把日志 payload 恢复成纯文本再匹配连接 id。
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '')

// sing-box 日志以连接 id 开头,如 [3829292130 5ms] router: match[0]
export const getLogConnectionID = (payload: string) => {
  return stripAnsi(payload).match(/^\[(\d+)\s[^\]]*\]/)?.[1] ?? null
}
