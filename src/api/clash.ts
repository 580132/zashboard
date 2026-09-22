// api 层 · Clash 通道(REST / WebSocket)的纯请求函数。
//
// 本文件以 mihomo API 为分类基准,smart、sing-box、honk、reFind 均视为兼容实现:
//   1. mihomo 标准 —— mihomo 提供的标准端点
//   2. smart 附加   —— smart 相对 mihomo 增加的端点
//   3. sing-box 专属 —— sing-box 的 Clash 兼容 API 提供的端点
//   4. honk 附加    —— honk 相对 mihomo 增加的端点
//   5. reFind 附加  —— reFind 相对 mihomo 增加的端点
// honk 实现的是通用分区的子集(没有 /upgrade/ui),差异见能力表。
// sing-box API(gRPC)是另一条通道,不在这里,见 api/singbox/。
//
// 兼容实现未覆盖的 mihomo 标准端点视为能力不足,由 assembly/backend.ts
// 的能力表记录。本层只按来源归类请求,不做任何后端判断。
import type { ProbeResult } from '@/helper/connectivity'
import { getUrlFromBackend } from '@/helper/utils'
import { activeBackend } from '@/store/setup'
import type {
  Backend,
  Config,
  DNSQuery,
  HonkStats,
  NodeRank,
  Proxy,
  ProxyProvider,
  Rule,
  RuleProvider,
} from '@/types'
import axios from 'axios'
import { debounce } from 'lodash'
import ReconnectingWebSocket from 'reconnectingwebsocket'
import { shallowRef } from 'vue'
import './http'

export const fetchClashVersion = () => axios.get<{ version: string }>('/version')

export const fetchProxiesAPI = () => {
  return axios.get<{ proxies: Record<string, Proxy> }>('/proxies')
}

export const selectProxyAPI = (proxyGroup: string, name: string) => {
  return axios.put(`/proxies/${encodeURIComponent(proxyGroup)}`, { name })
}

export const deleteFixedProxyAPI = (proxyGroup: string) => {
  return axios.delete(`/proxies/${encodeURIComponent(proxyGroup)}`)
}

export const fetchProxyLatencyAPI = (proxyName: string, url: string, timeout: number) => {
  return axios.get<{ delay: number }>(`/proxies/${encodeURIComponent(proxyName)}/delay`, {
    params: {
      url,
      timeout,
    },
  })
}

export const fetchProxyProviderLatencyAPI = (
  providerName: string,
  proxyName: string,
  url: string,
  timeout: number,
) => {
  return axios.get<{ delay: number }>(
    `/providers/proxies/${encodeURIComponent(providerName)}/${encodeURIComponent(proxyName)}/healthcheck`,
    {
      params: {
        url,
        timeout,
      },
    },
  )
}

export const fetchProxyGroupLatencyAPI = (proxyName: string, url: string, timeout: number) => {
  return axios.get<Record<string, number>>(`/group/${encodeURIComponent(proxyName)}/delay`, {
    params: {
      url,
      timeout,
    },
  })
}

export const fetchProxyProviderAPI = () => {
  return axios.get<{ providers: Record<string, ProxyProvider> }>('/providers/proxies')
}

export const updateProxyProviderAPI = (name: string) => {
  return axios.put(`/providers/proxies/${encodeURIComponent(name)}`)
}

export const proxyProviderHealthCheckAPI = (name: string) => {
  return axios.get<Record<string, number>>(
    `/providers/proxies/${encodeURIComponent(name)}/healthcheck`,
    {
      timeout: 15000,
    },
  )
}

export const fetchRulesAPI = () => {
  return axios.get<{ rules: Rule[] }>('/rules')
}

export const fetchRuleProvidersAPI = () => {
  return axios.get<{ providers: Record<string, RuleProvider> }>('/providers/rules')
}

export const updateRuleProviderAPI = (name: string) => {
  return axios.put(`/providers/rules/${encodeURIComponent(name)}`)
}

export const disconnectClashByIdAPI = (id: string) => {
  return axios.delete(`/connections/${id}`)
}

export const disconnectAllClashAPI = () => {
  return axios.delete('/connections')
}

export const getConfigsAPI = () => {
  return axios.get<Config>('/configs')
}

export const patchConfigsAPI = (configs: Record<string, string | boolean | object | number>) => {
  return axios.patch('/configs', configs)
}

export const flushFakeIPAPI = () => {
  return axios.post('/cache/fakeip/flush')
}

export const flushDNSCacheAPI = () => {
  return axios.post('/cache/dns/flush')
}

export const queryDNSAPI = (params: { name: string; type: string }) => {
  return axios.get<DNSQuery>('/dns/query', {
    params,
  })
}

export const createClashWebSocket = <T>(url: string, searchParams?: Record<string, string>) => {
  const backend = activeBackend.value!
  const resurl = new URL(`${getUrlFromBackend(backend).replace('http', 'ws')}/${url}`)

  resurl.searchParams.append('token', backend.password || '')

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      resurl.searchParams.append(key, value)
    })
  }

  const data = shallowRef<T>()
  const websocket = new ReconnectingWebSocket(resurl.toString())

  const close = () => {
    websocket.close()
  }

  const messageHandler = ({ data: message }: { data: string }) => {
    data.value = JSON.parse(message)
  }

  websocket.onmessage = url === 'logs' ? messageHandler : debounce(messageHandler, 100)

  return {
    data,
    close,
  }
}

export const probeClashChannel = async (
  backend: Backend,
  timeout: number,
  signal?: AbortSignal,
): Promise<ProbeResult> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const onAbort = () => controller.abort()

  signal?.addEventListener('abort', onAbort, { once: true })

  const startAt = Date.now()
  const latency = () => Date.now() - startAt

  try {
    const res = await fetch(`${getUrlFromBackend(backend)}/version`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${backend.password}`,
      },
      signal: controller.signal,
    })

    if (res.ok) return { ok: true, latency: latency() }

    return {
      ok: false,
      latency: latency(),
      kind: res.status === 401 ? 'unauthorized' : 'http',
      message: `HTTP ${res.status}`,
    }
  } catch (e) {
    return {
      ok: false,
      latency: latency(),
      kind: controller.signal.aborted ? 'timeout' : 'network',
      message: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onAbort)
  }
}

// 按索引批量切换规则启用状态;sing-box 侧走 toggleRuleDisabledSingBoxAPI,
// reFind 侧走 toggleRuleDisabledRefindAPI。
export const toggleRuleDisabledAPI = (data: Record<number, boolean>) => {
  return axios.patch(`/rules/disable`, data)
}

export const reloadConfigsAPI = () => {
  return axios.put('/configs?reload=true', { path: '', payload: '' })
}

export const updateConfigsAPI = (
  config: { path?: string; payload?: string },
  force: boolean = false,
) => {
  return axios.put(`/configs${force ? '?force=true' : ''}`, {
    path: config.path || '',
    payload: config.payload || '',
  })
}

export const updateGeoDataAPI = () => {
  return axios.post('/configs/geo')
}

export const upgradeCoreAPI = (type: 'release' | 'alpha' | 'auto') => {
  const url = type === 'auto' ? '/upgrade' : `/upgrade?channel=${type}`

  return axios.post(url)
}

export const restartCoreAPI = () => {
  return axios.post('/restart')
}

// 面板自升级是 mihomo 标准能力;sing-box 的 Clash 兼容 API 也提供,
// honk 虽可加载 zashboard,但未提供此端点。
export const upgradeUIAPI = () => {
  return axios.post('/upgrade/ui')
}

export const getStorageAPI = () => {
  return axios.get<Record<string, unknown>>(`/storage/zashboard`)
}

export const setStorageAPI = (value: Record<string, string>) => {
  return axios.put(`/storage/zashboard`, value)
}

export const deleteStorageAPI = () => {
  return axios.delete(`/storage/zashboard`)
}

export const fetchSmartWeightsAPI = () => {
  return axios.get<{
    message: string
    weights: Record<string, NodeRank[]>
  }>(`/group/weights`)
}

export const flushSmartGroupWeightsAPI = () => {
  return axios.post(`/cache/smart/flush`)
}

export const blockConnectionByIdAPI = (id: string) => {
  return axios.delete(`/connections/smart/${id}`)
}

export const fetchHonkStatsAPI = () => axios.get<HonkStats>('/stats')

export const toggleRuleDisabledRefindAPI = (uuid: string) => {
  return axios.put(`/rules/${encodeURIComponent(uuid)}`)
}

// ==========================================================================
// sing-box 的 Clash 兼容 API 专属
// ==========================================================================

// sing-box 的规则带稳定 uuid,按 uuid 切换启用状态;mihomo 走 PATCH /rules/disable。
// 两者的选择由响应数据(rule.uuid 是否存在)决定,见 assembly/rules。
export const toggleRuleDisabledSingBoxAPI = (uuid: string) => {
  return axios.put(`/rules/${encodeURIComponent(uuid)}`)
}
