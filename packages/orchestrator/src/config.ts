// ★ 必须在读取 process.env 之前加载 .env 文件
//   之前项目让用户配 .env 但代码没加载，导致 API Key 永远读不到（E_PROMPT bug）
import "dotenv/config";

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
  // ★ BUG 修复：API key 不 trim，shell/.env 误配带尾空格会 401 且难排查。统一 trim。
  anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
  deepseekKey: process.env.DEEPSEEK_API_KEY?.trim() || undefined,
  openaiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  /** 形如 "deepseek/deepseek-chat"；省略则用 pi 默认 model */
  defaultModel: process.env.AICOWORK_DEFAULT_MODEL?.trim() || undefined,
  /**
   * WS 鉴权 token：前端连接 /ws 时需带上 ?token=xxx。
   * - 未设置时：仅允许本机回环（127.0.0.1 / localhost）连接，公网部署必须显式设置 token。
   * - 设置后：所有 WS 连接必须带正确 token，否则拒绝。
   * 生成建议：`node -e "console.log(require('crypto').randomUUID())"`
   */
  authToken: process.env.AICOWORK_AUTH_TOKEN?.trim() || undefined,
  /**
   * 监听地址：默认 127.0.0.1（仅本机）。公网/容器部署需显式设 HOST=0.0.0.0 + 配 token。
   * ★ BUG 修复：之前用 ?? 只挡 null/undefined，AICOWORK_HOST="" 空串会穿透，
   *   fastify.listen({host:""}) 在某些 OS 上等同于监听 0.0.0.0（所有网卡），
   *   配合未设 token 时公网可直连 /ws 调用 Agent = RCE。改用 || 同时挡空串。
   */
  host: process.env.AICOWORK_HOST?.trim() || "127.0.0.1",
};
