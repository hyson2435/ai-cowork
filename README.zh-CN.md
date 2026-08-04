<div align="center">

# AI Cowork

**两个 AI Agent 实时结对编程 —— 一个写代码，另一个实时审查并自动注入修复。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](./CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/hyson2435/ai-cowork?style=social)](https://github.com/hyson2435/ai-cowork/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/hyson2435/ai-cowork)](https://github.com/hyson2435/ai-cowork/commits)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

<!-- TODO: 录一段 10-15 秒 demo GIF 放这里，展示双 Agent 协作 + 预览，star 率高 3-5 倍 -->
<!-- ![demo](docs/demo.gif) -->

> 🎬 **Demo GIF 占位** —— 录一段 10-15 秒视频，展示 Coder 写代码 + Reviewer 标记问题 + 实时预览，然后把这一行替换为 `![demo](docs/demo.gif)`。带 demo GIF 的项目 star 率高 3-5 倍。

---

## 为什么用 ai-cowork？

大多数 AI 编程工具要么闭眼写代码（危险），要么让你手动审查每个改动（慢）。**ai-cowork 同时运行两个 Agent** —— Coder 负责构建，Reviewer 盯着每个改动，一旦发现严重问题，**自动把修复建议注入到 Coder 的下一轮**。你既拥有自主编码的速度，又有持续审查的安全性。

| | ai-cowork | 单 Agent 工具 |
|---|---|---|
| 实时代码审查 | ✅ 内置 Reviewer | ❌ 手动 |
| 严重问题自动修复 | ✅ 通过 `follow_up` 注入 | ❌ 你得手动再问 |
| 先规划再执行 | ✅ Plan 模式 + 审批面板 | ❌ 看情况 |
| 一键回滚 | ✅ 工作区快照 | ❌ 只能靠 git |
| 实时预览 | ✅ 内置静态服务器 | ❌ 自己搭 |
| 危险命令拦截 | ✅ 15 类命令实时拦 | ❌ 听天由命 |

## 功能特性

### 🤝 双 Agent 协作
- **Coder**：执行编码任务，拥有 read/write/edit/bash 工具
- **Reviewer**：在 Coder 每轮结束后自动审查变更文件；发现严重问题时，通过 `follow_up` 把修复建议注入 Coder —— **闭环自动修复**
- **Copilot 队列**：向 Reviewer 提问或请求审查特定文件；chat 任务可插队到 review 任务前

### 🛡️ 三档权限模式
启动 session 时选择：

| 模式 | Coder 工具 | 用途 |
|------|-------------|----------|
| `free`（默认） | 全部，高危命令实时拦截 | 日常开发 |
| `read-only` | 仅 read/grep/ls | 只读探索代码库 |
| `plan` | 全部，但 write/edit/bash 在批准前被拦截 | 复杂任务先出计划 |

### 🚫 危险命令拦截
`free` 模式下，15 类破坏性命令被实时拦截。命中后立即中止当前轮，并 steer 提示 Coder 改用安全方案：
- 递归强删（`rm -rf`、`rm /`）
- 提权操作（`sudo`、`su`、`chmod 777`、`mkfs`、`dd` 写设备）
- Git 历史破坏（`git push --force`、`git reset --hard`）
- 远程脚本执行（`curl | sh`）
- 全局安装/发布（`npm i -g`、`pip install -g`、`npm publish`）
- 持久化后门（写 `.bashrc`/`.profile`）、读取 SSH 密钥、Docker 清理等

### 📋 计划先行
`plan` 模式下，Coder 先用只读工具探索，然后输出结构化 markdown 计划（目标 / 步骤 / 文件 / 风险）。在 UI 审批面板批准前，写工具一直被拦截 —— 防止 AI 在复杂任务上跑偏。

### 🗂️ 工作区管理
- **Checkpoint**：随时给工作区打快照，一键回滚
- **Preview**：为 session 的 cwd 启动静态服务器，改动即时预览（经 orchestrator 代理 —— 无需额外端口）

## 架构

Monorepo 三包结构：

```
packages/
├── shared/        # zod schemas：ClientCommand + ServerEvent 协议
├── orchestrator/  # 后端：Fastify + WebSocket + pi-coding-agent
│   ├── server.ts            # WS 路由、预览代理
│   ├── session-registry.ts  # session 生命周期、权限拦截、计划状态机
│   ├── event-bridge.ts      # pi 事件 → 前端 ServerEvent 映射
│   ├── checkpoints.ts       # 快照创建/回滚
│   └── preview-server.ts    # 静态预览服务器
└── web/           # 前端：React + Vite + Zustand
    └── src/components/      # 文件树 / 代码视图 / 终端 / 思考流 / 计划面板 / Copilot 等
```

**事件流**：`pi-coding-agent` 事件 → `event-bridge` 扁平化 → `SessionRegistry` 广播 → WebSocket → 前端 store → React 渲染。

## 快速开始

### 环境要求
- Node.js ≥ 18
- 至少一个模型 API key（Anthropic / OpenAI / DeepSeek）

### 安装
```bash
git clone https://github.com/hyson2435/ai-cowork.git ai-cowork
cd ai-cowork
npm install
```

### 配置
```bash
cp .env.example .env
# 编辑 .env，填入你的 API key
```

### 开发模式（两个终端）
```bash
# 终端 1：启动后端（监听 :3001）
npm run dev:orch

# 终端 2：启动前端（监听 :3000，自动把 /ws 和 /preview 代理到 3001）
npm run dev:web
```
打开 http://localhost:3000，在启动表单里填入工作目录、任务、权限模式，点"启动 Agent"。

### 生产部署
```bash
npm run build                  # 构建 shared + orchestrator
npm run build -w @ai-cowork/web  # 构建前端静态资源
node packages/orchestrator/dist/server.js   # 启动后端
# 用任意静态服务器托管 packages/web/dist（反向代理 /ws 和 /preview 到 3001）
```

## 使用指南

### 启动 Session
- **工作目录**：Agent 操作的目标目录（绝对路径；不存在会自动创建）
- **模型**：如 `deepseek/deepseek-chat`、`anthropic/claude-sonnet-4-5`
- **初始任务**：用自然语言描述 Coder 要做什么
- **Reviewer**：勾选启用自动代码审查（默认开）
- **权限模式**：见上方"三档权限模式"

### Plan 模式工作流
1. 以 `plan` 模式启动。Coder 用只读工具探索，然后输出 markdown 计划。
2. 审批面板出现三个选项：
   - **批准并执行**：解锁写工具；Coder 执行计划
   - **要求修改**：提供反馈；Coder 重新规划
   - **拒绝重规划**：Coder 产出全新计划
3. 批准后，底部出现"计划已批准"条，可折叠查看原计划。

### 输入栏
- **发送（Steer）**：插入到当前轮，立即影响 Coder
- **Follow-up**：排队到下一轮
- **Abort**：紧急中断当前轮
- `Ctrl/Cmd + Enter` 快速发送

## 配置参考

| 环境变量 | 说明 | 默认值 |
|--------------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `DEEPSEEK_API_KEY` | DeepSeek API key | - |
| `AICOWORK_DEFAULT_MODEL` | 默认模型 | pi 默认 |
| `AICOWORK_HOST` | 监听地址（默认回环；设 `0.0.0.0` 对外暴露） | `127.0.0.1` |
| `AICOWORK_AUTH_TOKEN` | WS 鉴权 token（对外暴露时必填） | - |
| `PORT` | orchestrator 端口 | 3001 |

## 技术栈
- **后端**：Fastify 4 + @fastify/websocket + @mariozechner/pi-coding-agent + zod
- **前端**：React 18 + Vite 5 + Zustand + Monaco Editor（代码视图）
- **模型**：Anthropic / OpenAI / DeepSeek 等，经 pi-ai

## Roadmap

- [ ] 多模型路由（审查用便宜模型，写代码用强模型）
- [ ] Diff 感知 Reviewer（只审查变更 hunk，不读整文件）
- [ ] 测试运行集成（Reviewer 能触发测试，不只读代码）
- [ ] VS Code 扩展（在编辑器内用 ai-cowork）
- [ ] 自托管模型支持（Ollama / vLLM）

> 有想法？[开个 Discussion](https://github.com/hyson2435/ai-cowork/discussions) 或提 [issue](https://github.com/hyson2435/ai-cowork/issues)。

## 贡献
欢迎提 issue 和 PR。开发指南见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证
[MIT](./LICENSE)
