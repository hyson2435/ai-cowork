/** 运行配置，从环境变量读取。 */
export const config = {
  port: Number(process.env.PORT ?? 3001),
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  deepseekKey: process.env.DEEPSEEK_API_KEY,
  openaiKey: process.env.OPENAI_API_KEY,
  /** 形如 "deepseek/deepseek-chat"；省略则用 pi 默认 model */
  defaultModel: process.env.AICOWORK_DEFAULT_MODEL,
};
