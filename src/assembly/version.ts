// 组装层 · 版本与升级。
// fetchVersion 经 driver 路由到当前后端(Clash /version 或 sing-box gRPC getVersion)。
// 版本字符串是 core 轴(assembly/backend.ts)的唯一来源:这里探测完成后写入 core,
// 后端切换的瞬间先重置为 'unknown',避免沿用上一个后端的结论。
import DaeLogo from '@/assets/images/dae.jpg'
import HonkLogo from '@/assets/images/honk.svg'
import MetacubexLogo from '@/assets/images/metacubex.jpg'
import SingBoxLogo from '@/assets/images/sing-box.svg'
import { MIHOMO, MIHOMO_CHANNEL } from '@/constant'
import { fetchWithLocalCache } from '@/helper/cache'
import { getRequestErrorMessage } from '@/helper/request-error'
import { autoUpgradeCore, autoUpgradeDashboard, checkUpgradeCore } from '@/store/settings'
import { activeBackend } from '@/store/setup'
import type { Backend } from '@/types'
import { computed, nextTick, ref } from 'vue'
import { can, core, Core, resetCore } from './backend'
import { fetchCapabilities, resetCapabilities } from './capabilities'
import { driver } from './driver'

export const version = ref()
export const isCoreUpdateAvailable = ref(false)
export const isUIUpdateAvailable = ref(false)
export const zashboardVersion = ref(__APP_VERSION__)

export type BackendProbe = {
  uuid: string
  status: 'probing' | 'connected' | 'failed'
  latency: number
  message: string
}

export const backendProbe = ref<BackendProbe | undefined>()

// sing-box 内核启动时刻(ms epoch);0 表示未知 / 当前后端无此能力。
// 仅 sing-box API(GetStartedAt)提供,Clash /version 无运行时长。
export const startedAt = ref(0)

// sing-box 的版本串带 'sing-box' 标记(gRPC 通道的 type 即为 singbox,版本串可能缺前缀);
// honk 的 /version 返回 "honk <semver>"(见 honk-core/src/clash_api.rs 的 version handler)。
const detectCore = (versionString: string): Core => {
  if (versionString.includes('sing-box') || activeBackend.value?.type === 'singbox')
    return Core.Singbox
  if (/\bhonk\b/i.test(versionString)) return Core.Honk
  if (activeBackend.value?.type === 'dae') return Core.Dae
  if (!versionString) return Core.Unknown
  return Core.Mihomo
}

export const coreBrand = computed(() => {
  switch (core.value) {
    case Core.Singbox:
      return { logo: SingBoxLogo, url: 'https://github.com/sagernet/sing-box' }
    case Core.Honk:
      return { logo: HonkLogo, url: 'https://github.com/Glassyiris/honk' }
    case Core.Dae:
      return { logo: DaeLogo, url: 'https://github.com/daeuniverse/dae' }
    default:
      return {
        logo: MetacubexLogo,
        url: MIHOMO_CHANNEL[mihomo.value?.[0] ?? MIHOMO.Meta].url,
      }
  }
})

export const mihomo = computed<[MIHOMO, string] | undefined>(() => {
  if (core.value !== Core.Mihomo) return undefined

  const match = /(alpha-smart|alpha|beta|meta)-?(\w+)/.exec(version.value)
  switch (match?.[1]) {
    case 'alpha':
      return [MIHOMO.Alpha, match[2] ?? version.value]
    case 'alpha-smart':
      return [MIHOMO.Smart, match[2] ?? version.value]
    case 'meta':
      return [MIHOMO.Meta, match[2] ?? version.value]
    default:
      return [MIHOMO.Meta, version.value]
  }
})

// sing-box 的运行时长来自 gRPC GetStartedAt(仅 type=singbox 有能力,can 已门控)。
const fetchSingboxStartedAt = async (): Promise<number> => {
  const { getSingboxClient } = await import('@/api/singbox/client')
  const client = getSingboxClient()?.client
  if (!client) return 0
  try {
    const res = await client.getStartedAt({})
    return Number(res.startedAt)
  } catch {
    return 0
  }
}

export const restartCore = () => driver().system.restartCore()

export const upgradeCore = (channel: 'release' | 'alpha' | 'auto') =>
  driver().system.upgradeCore(channel)

export const upgradeUI = () => driver().system.upgradeUI()

const probeBackendVersion = async (backend: Backend) => {
  const startAt = Date.now()
  let versionString: string

  try {
    versionString = await driver().system.fetchVersion()
  } catch (e) {
    if (activeBackend.value?.uuid === backend.uuid) {
      backendProbe.value = {
        uuid: backend.uuid,
        status: 'failed',
        latency: 0,
        message: getRequestErrorMessage(e),
      }
    }
    throw e
  }

  if (activeBackend.value?.uuid !== backend.uuid) return

  version.value = versionString
  core.value = detectCore(version.value)

  if (backend.type === 'dae') {
    await fetchCapabilities()
  }

  backendProbe.value = {
    uuid: backend.uuid,
    status: 'connected',
    latency: Date.now() - startAt,
    message: '',
  }
  startedAt.value = can('startedAt') ? await fetchSingboxStartedAt() : 0

  if (!can('coreUpdateCheck') || !checkUpgradeCore.value || backend.disableUpgradeCore) return

  isCoreUpdateAvailable.value = await fetchIsCoreUpdateAvailable()

  if (isCoreUpdateAvailable.value && autoUpgradeCore.value) {
    upgradeCore('auto').catch(() => {})
  }
}

let probe: Promise<void> = Promise.resolve()

export const coreReady = async () => {
  await nextTick()
  await probe
}

export const probeActiveBackend = () => {
  const backend = activeBackend.value

  resetCore()
  resetCapabilities()
  version.value = ''
  startedAt.value = 0
  isCoreUpdateAvailable.value = false
  backendProbe.value = backend
    ? { uuid: backend.uuid, status: 'probing', latency: 0, message: '' }
    : undefined

  probe = backend ? probeBackendVersion(backend).catch(() => {}) : Promise.resolve()
  return probe
}

const fetchIsCoreUpdateAvailable = async () => {
  const versionNumber = mihomo.value?.[1] ?? version.value
  const { assets } = await fetchWithLocalCache<{ assets: { name: string }[] }>(
    MIHOMO_CHANNEL[mihomo.value?.[0] ?? MIHOMO.Meta].check_update_url,
    versionNumber,
  )

  return !assets.some(({ name }) => name.includes(versionNumber))
}

export const checkUIUpdate = async () => {
  const { tag_name } = await fetchWithLocalCache<{ tag_name: string }>(
    'https://api.github.com/repos/580132/zashboard/releases/latest',
    zashboardVersion.value,
  )

  // Fork tags carry a -singbox.N suffix (e.g. v3.25.0-singbox.1);
  // compare against the base version only.
  const baseTag = tag_name?.replace(/-singbox.*$/, '')

  isUIUpdateAvailable.value = Boolean(baseTag && baseTag !== `v${zashboardVersion.value}`)

  if (isUIUpdateAvailable.value && autoUpgradeDashboard.value) {
    // 自动升级不是用户点的,失败静默
    upgradeUI().catch(() => {})
  }
}
