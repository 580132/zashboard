// Driver · sing-box(sing-box API,gRPC daemon.StartedService)。
//
// 与 Clash 的拉取式不同,这里复用流驱动的组装实现(assembly/*/singbox.ts):
// 订阅推送直接重建共享状态,选择 / 测速后无需手动刷新,结果随流回填 UI。
// 不支持的端点在能力表(cap)已提前门控,这里显式 reject 作为兜底。
import { getSingboxClient, probeSingboxChannel } from '@/api/singbox/client'
import { apiVersion } from '@/assembly/backend'
import { fetchSingboxConfigs, patchSingboxConfigs } from '@/assembly/config/singbox'
import {
  closeAllSingboxConnections,
  closeSingboxConnection,
  connectionAccessor,
  fetchSingboxConnections,
} from '@/assembly/connections/singbox'
import { subscribeLogs } from '@/assembly/logs/singbox'
import { fetchMemoryAPI, fetchTrafficAPI } from '@/assembly/overview/singbox'
import {
  fetchSingboxProxies,
  getSingboxGroupDelays,
  getSingboxNodeDelay,
  resetSingboxProxies,
  runSingboxURLTest,
  selectSingboxOutbound,
} from '@/assembly/proxies/singbox'
import { fetchSingboxRules } from '@/assembly/rules/singbox'
import type { Driver, MemorySample, TrafficSample } from './types'

const reject =
  (what: string) =>
  (): Promise<never> =>
    Promise.reject(new Error(`Unsupported by sing-box backend: ${what}`))

export const singboxDriver: Driver = {
  type: 'singbox',

  // 换后端 / 重连时关掉 proxies 的常驻 gRPC 流(groups / outbounds)。
  reset: resetSingboxProxies,

  system: {
    probe: (backend, timeout, signal) => probeSingboxChannel(backend, timeout, signal),
    fetchVersion: async () => {
      const client = getSingboxClient()?.client
      if (!client) return 'sing-box'
      const v = await client.getVersion({})
      // usbip / openvpn / taildrop 的能力门槛按 gRPC apiVersion 判定。
      apiVersion.value = v.apiVersion
      return v.version.includes('sing-box') ? v.version : `sing-box ${v.version}`
    },
    upgradeCore: reject('core upgrade'),
    restartCore: reject('core restart'),
    upgradeUI: reject('UI upgrade'),
    getStorage: reject('settings storage read'),
    setStorage: reject('settings storage write'),
    deleteStorage: reject('settings storage delete'),
  },

  metrics: {
    traffic: () => fetchTrafficAPI<TrafficSample>(),
    memory: () => fetchMemoryAPI<MemorySample>(),
    fetchRuntimeStats: reject('runtime stats'),
  },

  proxies: {
    fetch: fetchSingboxProxies,
    select: (group, name) => selectSingboxOutbound(group, name),
    // sing-box 没有 fixed 节点概念,静默 no-op 即可。
    clearFixed: async () => {},
    testNode: async (name, _url, timeout) => {
      await runSingboxURLTest(name, timeout)
      return getSingboxNodeDelay(name)
    },
    testProviderNode: reject('proxy provider node test'),
    testGroup: async (group, _url, _timeout) => {
      await runSingboxURLTest(group)
      return getSingboxGroupDelays(group)
    },
    updateProvider: reject('proxy provider update'),
    healthCheckProvider: reject('proxy provider health check'),
    fetchSmartWeights: async () => ({}),
    flushSmartWeights: reject('smart group weights flush'),
  },

  rules: {
    // sing-box gRPC 没有 rules 列表端点;rules 页已按能力表关闸,这里返回空负载。
    fetch: fetchSingboxRules,
    updateProvider: reject('rule provider update'),
    toggleDisabled: reject('rule enable toggle'),
  },

  config: {
    fetch: fetchSingboxConfigs,
    patch: patchSingboxConfigs,
    reload: reject('config reload'),
    load: reject('config load'),
    updateGeoData: reject('geo database update'),
    flushFakeIP: reject('fake-ip cache flush'),
    flushDNSCache: reject('DNS cache flush'),
    queryDNS: reject('DNS query'),
  },

  logs: {
    subscribe: (level, onBatch) => subscribeLogs({ level }, onBatch),
  },

  connections: {
    accessor: connectionAccessor,
    subscribe: fetchSingboxConnections,
    disconnect: (id) => closeSingboxConnection(id),
    disconnectAll: () => closeAllSingboxConnections(),
    block: reject('connection block'),
  },
}
