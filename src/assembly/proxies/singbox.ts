// sing-box API(gRPC daemon.StartedService)后端的代理「组装逻辑」。
// 与 clash 的「拉取式」不同,这里是「流驱动」:订阅 SubscribeGroups / SubscribeOutbounds,
// 每次推送直接重建共享状态(state),因此选择 / 测速后无需手动刷新,
// 结果会随流自动回填到 UI。对外经 assembly/driver/singbox 暴露给 driver。
import { getSingboxClient } from '@/api/singbox/client'
import type { StreamHandle } from '@/api/singbox/streams'
import { subscribeStream } from '@/api/singbox/subscriptions'
import type { ProxiesPayload } from '@/assembly/driver/types'
import { NOT_CONNECTED } from '@/constant'
import type { Group, GroupItem, Groups, OutboundList } from '@/gen/daemon/started_service_pb'
import { iconReflectList, speedtestTimeout } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import type { Proxy } from '@/types'
import { proxyGroupList, proxyMap, proxyProviederList } from './state'

const getHistoryFromItem = (item: GroupItem): Proxy['history'] =>
  item.urlTestDelay > 0
    ? [
        {
          time: new Date(Number(item.urlTestTime) * 1000).toISOString(),
          delay: item.urlTestDelay,
        },
      ]
    : []

const nodeToProxy = (item: GroupItem): Proxy => {
  return {
    name: item.tag,
    type: item.type,
    now: '',
    history: getHistoryFromItem(item),
    extra: {},
    icon: '',
  }
}

let groups = new Map<string, Group>()
let outbounds = new Map<string, GroupItem>()
let handles: StreamHandle[] = []
let sessionKey = ''
let ready: Promise<void> | null = null

type URLTestWaiter = {
  resolve: () => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const urlTestWaiters = new Set<URLTestWaiter>()

const resolveURLTestWaiters = () => {
  for (const waiter of urlTestWaiters) {
    clearTimeout(waiter.timer)
    waiter.resolve()
  }
  urlTestWaiters.clear()
}

const rejectURLTestWaiters = (reason: Error) => {
  for (const waiter of urlTestWaiters) {
    clearTimeout(waiter.timer)
    waiter.reject(reason)
  }
  urlTestWaiters.clear()
}

const waitForURLTestResult = (timeout: number) => {
  let waiter!: URLTestWaiter
  const promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        urlTestWaiters.delete(waiter)
        reject(new Error('sing-box URL test result timeout'))
      },
      Math.max(5000, timeout) + 1000,
    )

    waiter = { resolve, reject, timer }
    urlTestWaiters.add(waiter)
  })

  return {
    promise,
    cancel: () => {
      clearTimeout(waiter.timer)
      urlTestWaiters.delete(waiter)
    },
  }
}

// 用原始数据直接包装成门面状态(与 clash 的 provider / GLOBAL / 排序等无关)。
const rebuild = () => {
  const proxies: Record<string, Proxy> = {}

  // 1) 叶子叶子节点(平铺)
  for (const item of outbounds.values()) {
    proxies[item.tag] = nodeToProxy(item)
  }
  // 2) 分组里的 items 里缺失的叶子节点(outbounds 流可能漏掉或不含某些成员)
  for (const group of groups.values()) {
    for (const item of group.items) {
      if (!proxies[item.tag]) proxies[item.tag] = nodeToProxy(item)
    }
  }
  // 3) 分组条目(携带 all / now),初始按分组内节点顺序
  for (const group of groups.values()) {
    proxies[group.tag] = {
      name: group.tag,
      type: group.type,
      now: group.selected,
      all: group.items.map((i) => i.tag),
      selectable: group.selectable,
      history: [],
      extra: {},
      icon: '',
    }
  }
  // 4) 分组里的 items 里延迟缓存回叶子节点(还原带 all 的分组条目)
  for (const group of groups.values()) {
    for (const item of group.items) {
      const node = proxies[item.tag]
      if (node && !node.all?.length && item.urlTestDelay > 0) {
        node.history = getHistoryFromItem(item)
      }
    }
  }
  // 5) 应用用户设置的「名称映射图标」(与 clash 一致,sing-box 不带图标)
  for (const iconReflect of iconReflectList.value) {
    const node = proxies[iconReflect.name]
    if (node) node.icon = iconReflect.icon
  }

  proxyMap.value = proxies
  proxyGroupList.value = Array.from(groups.values())
    .filter((g) => g.items.length)
    .map((g) => g.tag)
  proxyProviederList.value = []
}

const closeStreams = () => {
  handles.forEach((h) => h.close())
  handles = []
  rejectURLTestWaiters(new Error('sing-box proxy stream closed'))
  sessionKey = ''
  ready = null
}

const stop = () => {
  closeStreams()
  groups = new Map()
  outbounds = new Map()
}

const ensureSession = () => {
  const backend = activeBackend.value
  const client = getSingboxClient()?.client
  if (!backend || backend.type !== 'singbox' || !client) {
    stop()
    return
  }
  if (sessionKey === backend.uuid && handles.length) return

  stop()
  sessionKey = backend.uuid

  let resolveReady!: () => void
  let resolved = false
  ready = new Promise<void>((r) => (resolveReady = r))

  handles = [
    subscribeStream<Groups>('groups', (msg) => {
      groups = new Map()
      for (const g of msg.group) groups.set(g.tag, g)
      rebuild()
      if (!resolved) {
        resolved = true
        resolveReady()
      } else {
        // URLTest RPC 只会等来一次历史记录更新后,这里才把等待者放行。
        resolveURLTestWaiters()
      }
    }),
    subscribeStream<OutboundList>('outbounds', (msg) => {
      outbounds = new Map()
      for (const o of msg.outbounds) outbounds.set(o.tag, o)
      rebuild()
    }),
  ]
}

// 换内核 / 断线时由 driver.reset() 触发的「关流」。
export const resetSingboxProxies = () => stop()

export const fetchSingboxProxies = async (): Promise<ProxiesPayload> => {
  ensureSession()
  if (ready) await ready
  rebuild()

  return { proxies: { ...proxyMap.value }, providers: [] }
}

export const selectSingboxOutbound = async (proxyGroupName: string, proxyName: string) => {
  const client = getSingboxClient()?.client
  const proxyGroup = proxyMap.value[proxyGroupName]
  if (!client || proxyGroup?.selectable === false) return

  await client.selectOutbound({ groupTag: proxyGroupName, outboundTag: proxyName })

  // 防止悬空:本地确认后再重建(流推送也会回填)。
  const group = groups.get(proxyGroupName)
  if (group) {
    group.selected = proxyName
    rebuild()
  }
}

export const runSingboxURLTest = async (outboundTag: string, timeout = speedtestTimeout.value) => {
  ensureSession()
  if (ready) await ready

  const client = getSingboxClient()?.client
  if (!client) return

  // 先注册等待者,避免测试很快时错过第一帧消息(一元 RPC 响应可能先失败)。
  const result = waitForURLTestResult(timeout)
  try {
    await Promise.all([client.uRLTest({ outboundTag }), result.promise])
  } finally {
    result.cancel()
  }
}

// 测速后从分组条目/叶子节点的历史里取回延迟。
export const getSingboxNodeDelay = (name: string): number => {
  const history = proxyMap.value[name]?.history

  return history?.length ? history[history.length - 1].delay : NOT_CONNECTED
}

export const getSingboxGroupDelays = (group: string): Record<string, number> => {
  const g = groups.get(group)

  return g ? Object.fromEntries(g.items.map((item) => [item.tag, item.urlTestDelay])) : {}
}
