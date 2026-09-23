// 组装层 · 后端会话。
//
// 一次会话 = 面板为某个后端建立起来的整套运行时状态:内核探测 + 首屏数据 +
// 三条常驻流(connections / logs / traffic)。切后端、改当前后端的连接参数、
// 用户手动重连,本质都是「结束旧会话、开一条新的」,所以共用 startBackendSession——
// 重连不需要额外的响应式开关,再调一次就是了。
//
// 世代号只在模块内部用:startBackendSession 中途有 await,快速连切后端时
// 旧会话醒来必须让位给新会话,不能抢着建流。
import { activeBackend } from '@/store/setup'
import { watch } from 'vue'
import { can } from './backend'
import { fetchConfigs } from './config'
import { initConnections, stopConnections } from './connections'
import { fetchDaeRuntime } from './dae'
import { driver } from './driver'
import { initLogs, stopLogs } from './logs'
import { initSatistic, stopSatistic } from './overview'
import { fetchProxies } from './proxies'
import { fetchRules } from './rules'
import { probeActiveBackend } from './version'

let generation = 0

const EVENT_DEBOUNCE = 400

let events: { close: () => void } | undefined
let refreshTimer: ReturnType<typeof setTimeout> | undefined

const scheduleRefresh = () => {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    fetchProxies().catch(() => {})
    fetchRules().catch(() => {})
    fetchConfigs().catch(() => {})
  }, EVENT_DEBOUNCE)
}

const stopEvents = () => {
  clearTimeout(refreshTimer)
  refreshTimer = undefined
  events?.close()
  events = undefined
}

const initEvents = () => {
  stopEvents()

  const subscribe = driver().events?.subscribe

  if (!subscribe || !can('backendEvents')) return

  events = subscribe((kind) => {
    if (kind === 'generation.changed') scheduleRefresh()
  })
}

export const startBackendSession = async () => {
  const current = ++generation

  // 三条常驻流连同各自的数据在这里同步丢掉,不能留到下面重建时再清:本函数是 pre 型
  // watcher,它一让出执行权(await),组件就会带着「新后端 + 旧后端的数据」重绘一帧。
  // 连接尤其致命 —— 字段访问器按当前后端路由,形状对不上会直接把渲染打崩
  // (详见 assembly/connections 的注释);日志与统计则是安静地冒充新后端的数据。
  stopConnections()
  stopLogs()
  stopSatistic()
  stopEvents()
  driver().reset?.()

  // 后端被清空(登出 / 401 / 新增后端)时就停在这:常驻流上面已经关掉,
  // 否则它们会以无主状态留在 Setup 页继续运行并无限重连。
  if (!activeBackend.value) {
    probeActiveBackend()
    return
  }

  // 等探测有结论再建流:cap(core / apiVersion)此时才是最终答案。
  await probeActiveBackend().catch(() => {})
  if (current !== generation) return

  fetchConfigs()
  fetchProxies()
  fetchRules()
  initConnections()
  initLogs()
  initSatistic()
  initEvents()

  if (activeBackend.value.type === 'dae') {
    fetchDaeRuntime().catch(() => {})
  }
}

// 会话跟着 activeBackend 走:换后端要重建,把当前后端的地址 / 密码改掉同样要重建。
watch(activeBackend, startBackendSession, { immediate: true })
