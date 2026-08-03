# AI Cowork

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/hysonwang/ai-cowork?style=social)](https://github.com/hysonwang/ai-cowork/stargazers)

[English](README.md) | [简体中文](README.zh-CN.md)

基于 LLM 的结对编程工作台：一个 **Coder Agent** 写代码，一个 **Reviewer Agent** 实时审查，配合计划审批、快照回滚、预览、危险命令拦截等安全机制，让 AI 改代码既高效又可控。

## 功能特性

### 双 Agent 协作
- **Coder**：执行编码任务，可调用 read/write/edit/bash 等工具
- **Reviewer**：每次 Coder 完成一轮修改后自动审查变更文件，发现严重问题会通过 `follow_up` 注入修复建议
- **Copilot 队列**：可向 Reviewer 提问或要求审查指定文件，支持插队

### 三层权限模式（安全防护）
启动会话时可选：
| 模式 | Coder 可用工具 | 适用场景 |
|------|---------------|---------|
| `free`（默认） | 全部，拦截高危命令 | 日常开发 |
| `read-only` | 仅 read/grep/ls | 只读探索代码库 |
| `plan` | 全部，但未批准前拦截 write/edit/bash | 复杂任务先出方案 |

### 危险命令拦截
`free` 模式下实时拦截 15 类破坏性命令，命中后立即 abort 并 steer Coder 改用安全方案：
- 递归强删（`rm -rf`、`rm /`）
- 提权（`sudo`、`su`、`chmod 777`、`mkfs`、`dd 写设备`）
- Git 破坏历史（`git push --force`、`git reset --hard`）
- 远程脚本执行（`curl | sh`）
- 全局安装 / 发布（`npm i -g`、`pip install -g`、`npm publish`）
- 持久化后门（写 `.bashrc`/`.profile`）、读取 SSH 密钥、Docker 清理等

### Plan 先行
`plan` 模式下 Coder 先输出结构化 markdown 计划（目标/实现步骤/涉及文件/风险），用户在 UI 审批面板批准后才解锁写工具执行，避免 AI 跑偏。

### 工作区管理
- **Checkpoint**：任意时刻创建工作区快照，一键回滚
- **Preview**：为会话 cwd 启动静态服务器，改完即时预览（经 orchestrator 代理，无需额外端口）

## 架构

Monorepo 三端：

```
packages/
├── shared/        # zod schema：ClientCommand + ServerEvent 协议定义
├── orchestrator/  # 后端：Fastify + WebSocket + pi-coding-agent
│   ├── server.ts            # WS 路由、预览代理
│   ├── session-registry.ts  # 会话生命周期、权限拦截、计划状态机
│   ├── event-bridge.ts      # pi 事件 → 前端 ServerEvent 映射
│   ├── checkpoints.ts       # 快照创建/回滚
│   └── preview-server.ts    # 静态预览服务器
└── web/           # 前端：React + Vite + Zustand
    └── src/components/      # 文件树/代码视图/终端/思考流/计划面板/Copilot 等
```

**事件流**：`pi-coding-agent` 事件 → `event-bridge` 扁平化 → `SessionRegistry` broadcast → WebSocket → 前端 store → React 渲染。

## 快速开始

### 环境要求
- Node.js ≥ 18
- 至少一个模型 API Key（Anthropic / OpenAI / DeepSeek）

### 安装
```bash
git clone https://github.com/hysonwang/ai-cowork.git ai-cowork
cd ai-cowork
npm install
```

### 配置
```bash
cp .env.example .env
# 编辑 .env，填入你的 API Key
```

### 开发模式（两个终端）
```bash
# 终端 1：启动后端（监听 :3001）
npm run dev:orch

# 终端 2：启动前端（监听 :3000，自动代理 /ws 和 /preview 到 3001）
npm run dev:web
```
浏览器打开 http://localhost:3000 ，在启动表单填工作目录、任务、权限模式，点「启动 Agent」。

### 生产部署
```bash
npm run build                  # 构建 shared + orchestrator
npm run build -w @ai-cowork/web  # 构建前端静态产物
node packages/orchestrator/dist/server.js   # 启动后端
# 前端用任意静态服务器托管 packages/web/dist（需把 /ws、/preview 反代到 3001）
```

## 使用指南

### 启动会话
- **工作目录**：Agent 操作的目标目录（绝对路径，不存在会自动创建）
- **模型**：形如 `deepseek/deepseek-chat`、`anthropic/claude-sonnet-4-5`
- **初始任务**：用自然语言描述要让 Coder 做的事
- **Reviewer**：勾选后启用自动代码审查（默认开启）
- **权限模式**：见上方「三层权限模式」

### Plan 模式工作流
1. 选 `plan` 模式启动，Coder 用只读工具探索后输出 markdown 计划
2. 弹出审批面板，可选：
   - **批准并执行**：解锁写工具，Coder 按计划执行
   - **要求修改**：填写反馈，Coder 重新规划
   - **拒绝重规划**：Coder 完全重新出方案
3. 批准后底部出现「计划已批准」回看条，可折叠查看原计划

### 输入栏
- **发送（Steer）**：插入到当前 turn，立即影响 Coder
- **Follow-up**：排队到下一轮 turn
- **Abort**：紧急中断当前 turn
- `Ctrl/Cmd + Enter` 快速发送

## 配置参考

| 环境变量 | 说明 | 默认 |
|---------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key | - |
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | - |
| `AICOWORK_DEFAULT_MODEL` | 默认模型 | pi 默认 |
| `PORT` | orchestrator 端口 | 3001 |

## 技术栈
- **后端**：Fastify 4 + @fastify/websocket + @mariozechner/pi-coding-agent + zod
- **前端**：React 18 + Vite 5 + Zustand + Monaco Editor（代码视图）
- **模型**：经 pi-ai 支持 Anthropic / OpenAI / DeepSeek 等

## 贡献
欢迎提 Issue 和 PR。开发指南见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证
[MIT](./LICENSE)
