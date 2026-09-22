// sing-box 后端不支持 rules 列表(gRPC 无对应端点),返回空负载占位。
// rules 页已按能力表对它关闸,这里仅满足 driver 接口。
export const fetchSingboxRules = async () => ({
  rules: [],
  providers: [],
})
