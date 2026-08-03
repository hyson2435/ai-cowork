/** 运行配置，从环境变量读取。 */
function parsePort(raw: string | undefined, def: number): number {
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw} (expected integer in 1..65535)`);
  }
  return n;
}

export const config = {
  port: parsePort(process.env.PORT, 3001),
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  deepseekKey: process.env.DEEPSEEK_API_KEY,
  openaiKey: process.env.OPENAI_API_KEY,
  /** 形如 "deepseek/deepseek-chat"；省略则用 pi 默认 model */
  defaultModel: process.env.AICOWORK_DEFAULT_MODEL,
  /**
   * WS 鉴权 token：前端连接 /ws 时需带上 ?token=xxx。
   * - 未设置时：仅允许本机回环（127.0.0.1 / localhost）连接，公网部署必须显式设置 token。
   * - 设置后：所有 WS 连接必须带正确 token，否则拒绝。
   * 生成建议：`node -e "console.log(require('crypto').randomUUID())"`
   */
  authToken: process.env.AICOWORK_AUTH_TOKEN,
  /** 监听地址：默认 127.0.0.1（仅本机）。公网/容器部署需显式设 HOST=0.0.0.0 + 配 token。 */
  host: process.env.AICOWORK_HOST ?? "127.0.0.1",
};
