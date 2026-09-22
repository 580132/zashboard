// sing-box 侧的 config 封装:仅暴露 clash-mode,其余选项保留默认。
// 按 gRPC getClashModeStatus 的结果转成 Clash 的 Config 形状,
// fetch 返回值(状态写入由 assembly/config 统一负责)。
import { getSingboxClient } from '@/api/singbox/client'
import { defaultConfig } from '@/assembly/config'
import type { Config } from '@/types'

export const fetchSingboxConfigs = async (): Promise<Config> => {
  const client = getSingboxClient()?.client
  if (!client) return { ...defaultConfig }
  const status = await client.getClashModeStatus({})
  return {
    ...defaultConfig,
    mode: status.currentMode,
    'mode-list': status.modeList,
    modes: status.modeList,
  }
}

// patch 只认 mode(模式切换);其余配置块是 mihomo 扩展,cap 已门控。
export const patchSingboxConfigs = async (cfg: Record<string, string | boolean | object | number>) => {
  if (typeof cfg.mode === 'string') {
    const client = getSingboxClient()?.client
    if (client) await client.setClashMode({ mode: cfg.mode })
  }
}
