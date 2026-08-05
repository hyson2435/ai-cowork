<div align="center">

# AI Cowork

**Two AI agents pair-program in real time — one writes code, the other reviews it live and auto-injects fixes.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](./CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/hyson2435/ai-cowork?style=social)](https://github.com/hyson2435/ai-cowork/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/hyson2435/ai-cowork)](https://github.com/hyson2435/ai-cowork/commits)

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

<!-- TODO: 录一段 10-15 秒 demo GIF 放这里，展示双 Agent 协作 + 预览，star 率高 3-5 倍 -->
![demo](docs/demo.gif)

> 🎬 15-second demo: Start session → Coder writes code → Reviewer flags a severe XSS issue → Copilot auto-injects a fix → live preview refreshes.
---

## Why ai-cowork?

Most AI coding tools either write code blindly (risky) or make you review every change manually (slow). **ai-cowork runs two agents in parallel** — the Coder builds, the Reviewer watches every change and, when it spots a severe issue, **auto-injects a fix into the next Coder turn**. You get the speed of autonomous coding with the safety of continuous review.

| | ai-cowork | Single-agent tools |
|---|---|---|
| Real-time code review | ✅ Built-in Reviewer agent | ❌ Manual |
| Auto-fix on severe issues | ✅ Injected via `follow_up` | ❌ You re-prompt |
| Plan before execute | ✅ Plan mode + approval panel | ❌ Often |
| One-click rollback | ✅ Workspace snapshots | ❌ Git only |
| Live preview | ✅ Built-in static server | ❌ Separate setup |
| Dangerous command guard | ✅ 15 categories intercepted | ❌ Hope for the best |

## Features

### 🤝 Dual-Agent Collaboration
- **Coder**: executes coding tasks with read/write/edit/bash tools
- **Reviewer**: automatically reviews changed files after each Coder turn; when severe issues are found, a fix suggestion is injected into the Coder via `follow_up` — **the loop closes itself**
- **Copilot Queue**: ask the Reviewer questions or request reviews of specific files; chat tasks can jump the queue ahead of reviews

### 🛡️ Three-Tier Permission Modes
Choose when starting a session:

| Mode | Coder tools | Use case |
|------|-------------|----------|
| `free` (default) | All, with high-risk commands intercepted | Daily development |
| `read-only` | Only read/grep/ls | Read-only codebase exploration |
| `plan` | All, but write/edit/bash are blocked until approval | Plan before executing complex tasks |

### 🚫 Dangerous Command Interception
In `free` mode, 15 categories of destructive commands are intercepted in real time. On hit, the turn is aborted immediately and the Coder is steered to a safer approach:
- Recursive force delete (`rm -rf`, `rm /`)
- Privilege escalation (`sudo`, `su`, `chmod 777`, `mkfs`, `dd` to devices)
- Git history destruction (`git push --force`, `git reset --hard`)
- Remote script execution (`curl | sh`)
- Global install / publish (`npm i -g`, `pip install -g`, `npm publish`)
- Persistent backdoors (writing `.bashrc`/`.profile`), reading SSH keys, Docker cleanup, etc.

### 📋 Plan First
In `plan` mode, the Coder first outputs a structured markdown plan (goal / steps / files / risks). Write tools stay blocked until you approve the plan in the UI approval panel — preventing the AI from going off track on complex tasks.

### 🗂️ Workspace Management
- **Checkpoint**: snapshot the workspace at any time and roll back with one click
- **Preview**: a static server is started for the session's cwd, so changes can be previewed instantly (proxied through the orchestrator — no extra port needed)

## Architecture

Monorepo with three packages:

```
packages/
├── shared/        # zod schemas: ClientCommand + ServerEvent protocol
├── orchestrator/  # backend: Fastify + WebSocket + pi-coding-agent
│   ├── server.ts            # WS routes, preview proxy
│   ├── session-registry.ts  # session lifecycle, permission interception, plan state machine
│   ├── event-bridge.ts      # pi events → frontend ServerEvent mapping
│   ├── checkpoints.ts       # snapshot creation / rollback
│   └── preview-server.ts    # static preview server
└── web/           # frontend: React + Vite + Zustand
    └── src/components/      # file tree / code view / terminal / thought stream / plan panel / Copilot, etc.
```

**Event flow**: `pi-coding-agent` events → `event-bridge` flattening → `SessionRegistry` broadcast → WebSocket → frontend store → React rendering.

## Quick Start

### Requirements
- Node.js ≥ 18
- At least one model API key (Anthropic / OpenAI / DeepSeek)

### Install
```bash
git clone https://github.com/hyson2435/ai-cowork.git ai-cowork
cd ai-cowork
npm install
```

### Configure
```bash
cp .env.example .env
# Edit .env and fill in your API key
```

### Development mode (two terminals)
```bash
# Terminal 1: start backend (listens on :3001)
npm run dev:orch

# Terminal 2: start frontend (listens on :3000, auto-proxies /ws and /preview to 3001)
npm run dev:web
```
Open http://localhost:3000, fill in the working directory, task, and permission mode in the launch form, then click "Start Agent".

### Production deployment
```bash
npm run build                  # build shared + orchestrator
npm run build -w @ai-cowork/web  # build frontend static assets
node packages/orchestrator/dist/server.js   # start backend
# Serve packages/web/dist with any static server (reverse-proxy /ws and /preview to 3001)
```

## Usage Guide

### Starting a Session
- **Working directory**: the target directory the Agent operates on (absolute path; created automatically if missing)
- **Model**: e.g. `deepseek/deepseek-chat`, `anthropic/claude-sonnet-4-5`
- **Initial task**: describe in natural language what the Coder should do
- **Reviewer**: tick to enable automatic code review (on by default)
- **Permission mode**: see "Three-Tier Permission Modes" above

### Plan Mode Workflow
1. Start in `plan` mode. The Coder explores with read-only tools, then outputs a markdown plan.
2. The approval panel appears with three options:
   - **Approve & execute**: unlock write tools; the Coder executes the plan
   - **Request changes**: provide feedback; the Coder re-plans
   - **Reject & re-plan**: the Coder produces a completely new plan
3. After approval, a "Plan approved" bar appears at the bottom and can be collapsed to review the original plan.

### Input Bar
- **Send (Steer)**: insert into the current turn, affecting the Coder immediately
- **Follow-up**: queue for the next turn
- **Abort**: emergency-interrupt the current turn
- `Ctrl/Cmd + Enter` to send quickly

## Configuration Reference

| Env variable | Description | Default |
|--------------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `DEEPSEEK_API_KEY` | DeepSeek API key | - |
| `AICOWORK_DEFAULT_MODEL` | Default model | pi default |
| `AICOWORK_HOST` | Listen address (default loopback; set `0.0.0.0` to expose) | `127.0.0.1` |
| `AICOWORK_AUTH_TOKEN` | WS auth token (required when exposing to public) | - |
| `PORT` | orchestrator port | 3001 |

## Tech Stack
- **Backend**: Fastify 4 + @fastify/websocket + @mariozechner/pi-coding-agent + zod
- **Frontend**: React 18 + Vite 5 + Zustand + Monaco Editor (code view)
- **Models**: Anthropic / OpenAI / DeepSeek etc. via pi-ai

## Roadmap

- [ ] Multi-model routing (cheap model for review, strong model for code)
- [ ] Diff-aware Reviewer (only review changed hunks, not whole files)
- [ ] Test-run integration (Reviewer can trigger tests, not just read code)
- [ ] VS Code extension (use ai-cowork inside your editor)
- [ ] Self-hosted model support (Ollama / vLLM)

> Have an idea? [Open a discussion](https://github.com/hyson2435/ai-cowork/discussions) or an [issue](https://github.com/hyson2435/ai-cowork/issues).

## Contributing
Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev guide.

## License
[MIT](./LICENSE)
