# 贡献指南

感谢你对 AI Cowork 的兴趣！本文档帮助你快速参与开发。

## 开发环境

### 前置要求
- Node.js ≥ 18
- 一个模型 API Key（用于本地联调，见 `.env.example`）

### 搭建本地开发
```bash
git clone <repo-url> && cd ai-cowork
npm install
cp .env.example .env   # 填入 API Key
npm run build:shared    # 首次必须先构建 shared，orchestrator/web 依赖其产物
```

日常开发开两个终端：
```bash
npm run dev:orch   # 后端热重载（tsx watch）
npm run dev:web    # 前端热重载（Vite）
```

## 代码结构

Monorepo（npm workspaces），三端依赖关系：`web` / `orchestrator` → `shared`。

### shared（`packages/shared/src/index.ts`）
前后端共享的 zod schema：
- `ClientCommand`：前端 → 后端的命令（`session.start` / `plan.approve` 等）
- `ServerEvent`：后端 → 前端的事件（`text_delta` / `plan.proposed` 等）
- 改协议时先改这里，三端同步。改完必须 `npm run build:shared` 再跑其他端。

### orchestrator（`packages/orchestrator/src/`）
后端核心，关键文件：
- `server.ts`：Fastify + WS 入口，路由所有 `ClientCommand`，`/preview/:sessionId/*` 反代
- `session-registry.ts`：会话生命周期、权限拦截（`PLAN_BLOCKED_TOOLS` / `checkDangerousCommand`）、计划状态机、Reviewer/Copilot 队列
- `event-bridge.ts`：`pi-coding-agent` 事件 → 前端 `ServerEvent` 的扁平化映射
- `checkpoints.ts` / `preview-server.ts`：快照与预览

### web（`packages/web/src/`）
前端，关键文件：
- `store.ts`：Zustand 全局状态，`ws.ts` 收到事件后更新
- `ws.ts`：WS 客户端，把 `ServerEvent` 分发到 store
- `components/`：各功能面板（`PlanApprovalPanel` / `ThoughtStream` / `CopilotPanel` 等）

## 类型检查与构建

```bash
# 三端分别构建
npm run build:shared
npm run build -w @ai-cowork/orchestrator
npm run build -w @ai-cowork/web

# 严格模式额外检查未使用变量（CI 建议开启）
npx tsc -p packages/orchestrator/tsconfig.json --noUnusedLocals --noUnusedParameters --noEmit
npx tsc -p packages/web/tsconfig.json --noUnusedLocals --noUnusedParameters --noEmit
```

提交前确保三端构建通过、无类型错误。

## 联调验证

无 API Key 也能验证纯逻辑（计划摘要、危险命令拦截等）。有 Key 时建议跑完整 plan 流程：
1. 浏览器选 `plan` 模式启动，确认 Coder 输出计划且审批面板弹出
2. 点批准，确认 Coder 解锁写工具并执行
3. `free` 模式下让 Coder 执行 `git push --force`，确认被拦截

## 提交规范

- 提交前 `npm run build` 确保通过
- Commit message 用中文或英文均可，建议格式：`<类型>: <描述>`，如 `feat: 新增 session 持久化` / `fix: plan 批准后工具未解锁`
- 一个 PR 聚焦一件事，避免混合多个无关改动

## 新增功能 checklist

涉及协议变更时：
1. `shared/src/index.ts` 加 schema
2. `orchestrator/src/session-registry.ts` 实现逻辑 + `server.ts` 路由
3. `web/src/ws.ts` 处理事件 + `store.ts` 加状态 + 组件渲染
4. 三端 build + 联调

涉及安全拦截时：
- 写明规则正则与适用模式
- 考虑绕过场景（如 `echo sudo` 不应误中 `sudo` 规则）
- 命中后必须 `abort` + `steer` 通知 Coder

## 行为准则

保持友善、尊重的交流。安全相关问题（如可被利用的漏洞）请勿公开 Issue，私信维护者。
