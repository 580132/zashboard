// 组装层 · 后端判别与能力表。
//
// 两条轴:
//   1. 后端类型(driver 轴):'clash' / 'singbox' / 'dae',决定走哪套 API
//      (Clash REST/WS、sing-box gRPC、dae gRPC)。能力表按它选表。
//   2. 内核品牌(core 轴):版本字符串探测得出,同一张表内再细分
//      (Clash 通道可能跑 mihomo / sing-box / honk 内核)。
//      探测完成前是 unknown,后端切换时重置,避免沿用上一个后端的结论。
//
// displayAllFeatures 是「越过能力表」的 fork 开关,生效范围见下。
import { displayAllFeatures } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import { computed, ref } from 'vue'
import { daeCapabilities } from './capabilities'

export enum Core {
  Mihomo = 'mihomo',
  Singbox = 'singbox',
  Honk = 'honk',
  Dae = 'dae',
  Unknown = 'unknown',
}

// sing-box gRPC API 版本门槛(daemon 的 apiVersion,由 driver/singbox 探测时写入):
// 低于对应版本的内核不显示该功能入口。
const USBIP_MIN_API_VERSION = 2
const OPENVPN_MIN_API_VERSION = 3
const TAILDROP_MIN_API_VERSION = 4

export const core = ref<Core>(Core.Unknown)
export const apiVersion = ref(0)

export const resetCore = () => {
  core.value = Core.Unknown
  apiVersion.value = 0
}

// displayAllFeatures 的生效范围:Clash 通道跑非 mihomo 内核(sing-box / honk)时。
// 打开它可越过能力表,把「这个 fork 的内核也支持这些 mihomo 扩展」的场景放开;
// 只限 Clash 通道 —— sing-box API(gRPC)通道的接口本来就不同,开了也无效。
// core 未探测出结果(Unknown)时不亮开关,先听探测结论的。
const isNonMihomoClashCore = computed(
  () =>
    activeBackend.value?.type === 'clash' &&
    (core.value === Core.Singbox || core.value === Core.Honk),
)

const isForkCoreOverride = computed(() => isNonMihomoClashCore.value && displayAllFeatures.value)

// 开关自身的可见性与其生效范围保持一致。
export const showDisplayAllFeatures = computed(
  () => !!activeBackend.value && isNonMihomoClashCore.value,
)

export type Cap =
  | 'coreUpgrade'
  | 'coreRestart'
  | 'dashboardUpgrade'
  | 'reloadConfigs'
  | 'updateConfigs'
  | 'updateGeoDatabase'
  | 'syncSettings'
  | 'independentLatency'
  | 'coreUpdateCheck'
  | 'configPatch'
  | 'traceLogLevel'
  | 'silentLogLevel'
  | 'runtimeStats'
  | 'latencyTest'
  | 'proxyProviderUpdate'
  | 'proxyProviderHealthCheck'
  | 'ruleProviders'
  | 'flushDNSCache'
  | 'flushFakeIP'
  | 'dnsQuery'
  | 'connectionsClose'
  | 'connectionsFilterClose'
  | 'customTestUrl'
  | 'nodeLatencyTest'
  | 'metricsHistory'
  | 'backendEvents'
  | 'flows'
  | 'dnsCache'
  | 'dnsLog'
  | 'routingTrace'
  | 'datapath'
  | 'runtimeSettings'
  | 'configSources'
  | 'configEdit'
  | 'entryManage'
  | 'groupConfigPatch'
  | 'lifecycleControl'
  // ---- fork 新增 ----
  | 'rules'
  | 'coreActions'
  | 'customGlobalNode'
  | 'disconnectOnModeChange'
  | 'extraLogLevels'
  | 'goroutines'
  | 'logConnectionDetail'
  | 'logTypeFilter'
  | 'openvpn'
  | 'startedAt'
  | 'taildrop'
  | 'tools'
  | 'usbip'

type Caps = Partial<Record<Cap, boolean>>

const clashCaps = computed<Caps>(() => {
  const mihomo = core.value === Core.Mihomo
  const singbox = core.value === Core.Singbox
  const honk = core.value === Core.Honk
  const mihomoOrForkCore = mihomo || isForkCoreOverride.value

  return {
    // ---------- mihomo 扩展 ----------
    coreUpgrade: mihomoOrForkCore,
    coreRestart: mihomoOrForkCore,
    // 面板自升级 /upgrade/ui:sing-box 的 Clash 兼容 API 也提供;按通道保留入口。
    dashboardUpgrade: true,
    reloadConfigs: mihomoOrForkCore,
    updateConfigs: mihomoOrForkCore,
    updateGeoDatabase: mihomoOrForkCore,
    syncSettings: mihomoOrForkCore,
    independentLatency: mihomoOrForkCore,
    coreUpdateCheck: mihomo,
    configPatch: mihomo,

    // ---------- Clash 通道固定可用(与内核品牌无关) ----------
    rules: true,
    coreActions: true,
    latencyTest: true,
    proxyProviderUpdate: true,
    proxyProviderHealthCheck: true,
    ruleProviders: true,
    flushDNSCache: true,
    flushFakeIP: true,
    dnsQuery: true,
    connectionsClose: true,
    customTestUrl: true,
    nodeLatencyTest: true,

    // ---------- sing-box 内核(Clash 通道) ----------
    customGlobalNode: singbox,
    logTypeFilter: singbox,
    logConnectionDetail: singbox,
    disconnectOnModeChange: singbox,

    // ---------- 日志级别集合 ----------
    traceLogLevel: honk || singbox,
    extraLogLevels: singbox,
    silentLogLevel: mihomo || singbox,

    runtimeStats: honk,
  }
})

// sing-box API(gRPC)通道:Clash 通道的 mihomo 扩展端点一律没有,
// 但日志 / 流 / 测速与 fork 专属能力(daemon.StartedService)齐全。
const singboxCaps = computed<Caps>(() => {
  return {
    customGlobalNode: true,
    logTypeFilter: true,
    logConnectionDetail: true,
    disconnectOnModeChange: true,

    traceLogLevel: true,
    extraLogLevels: true,
    silentLogLevel: true,

    latencyTest: true,
    nodeLatencyTest: true,
    connectionsClose: true,

    // fork 专属(sing-box API / gRPC daemon.StartedService)
    tools: true,
    goroutines: true,
    startedAt: true,
    usbip: apiVersion.value >= USBIP_MIN_API_VERSION,
    openvpn: apiVersion.value >= OPENVPN_MIN_API_VERSION,
    taildrop: apiVersion.value >= TAILDROP_MIN_API_VERSION,
  }
})

const daeCaps = computed<Caps>(() => {
  const resources = daeCapabilities.value?.resources

  return {
    reloadConfigs: resources?.reload.available === true,
    updateGeoDatabase: resources?.geodata.can_update === true,

    traceLogLevel: resources?.logs.levels?.includes('trace') === true,

    runtimeStats: resources?.runtime_outbounds.available === true,

    latencyTest: resources?.probes.available === true,
    proxyProviderUpdate: resources?.providers.can_refresh === true,
    flushDNSCache: resources?.dns_cache.flush === true,
    dnsQuery: resources?.dns_query.available === true,
    connectionsClose: resources?.connections.can_close === true,
    connectionsFilterClose: resources?.connections.can_close === true,
    metricsHistory:
      resources?.traffic_history.available === true || resources?.memory_history.available === true,
    backendEvents: resources?.events.available === true,
    flows: resources?.flows.available === true,
    dnsCache: resources?.dns_cache.read === true,
    dnsLog: resources?.dns_log.available === true,
    routingTrace: resources?.routing_trace.available === true,
    datapath: resources?.datapath.available === true,
    runtimeSettings: resources?.runtime_settings.available === true,
    configSources: resources?.config.available === true,
    configEdit: resources?.config.writable === true && resources?.config.content === true,
    entryManage: resources?.nodes.can_manage === true || resources?.providers.can_manage === true,
    groupConfigPatch: resources?.groups.config_patch === true,
    lifecycleControl: resources?.suspend.available === true && resources?.resume.available === true,

    // dae 有 rules 页与后端动作入口(规则页路由与动作列表按这两个 fork 能力门控)。
    rules: true,
    coreActions: true,
  }
})

const soft = computed<Caps>(() => {
  const type = activeBackend.value?.type

  if (type === 'dae') return daeCaps.value
  if (type === 'singbox') return singboxCaps.value
  return clashCaps.value
})

export const can = (cap: Cap): boolean => {
  if (!activeBackend.value) return false

  return soft.value[cap] === true
}
