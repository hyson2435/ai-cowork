# AI Cowork

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node: >=18](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/hysonwang/ai-cowork?style=social)](https://github.com/hysonwang/ai-cowork/stargazers)

[English](README.md) | [简体中文](README.zh-CN.md)

An LLM-powered pair-programming workbench: a **Coder Agent** writes code while a **Reviewer Agent** reviews changes in real time. Combined with plan approval, snapshot rollback, live preview, and dangerous-command interception, ai-cowork makes AI-driven code changes both fast and controllable.

## Features

### Dual-Agent Collaboration
- **Coder**: executes coding tasks with read/write/edit/bash tools
- **Reviewer**: automatically reviews changed files after each Coder turn; injects fix suggestions via `follow_up` when severe issues are found
- **Copilot Queue**: ask the Reviewer questions or request reviews of specific files, with chat tasks able to jump the queue

### Three-Tier Permission Modes (Safety)
Choose when starting a session:
| Mode | Coder tools | Use case |
|------|-------------|----------|
| `free` (default) | All, with high-risk commands intercepted | Daily development |
| `read-only` | Only read/grep/ls | Read-only codebase exploration |
| `plan` | All, but write/edit/bash are blocked until approval | Plan before executing complex tasks |

### Dangerous Command Interception
In `free` mode, 15 categories of destructive commands are intercepted in real time. On hit, the turn is aborted immediately and the Coder is steered to a safer approach:
- Recursive force delete (`rm -rf`, `rm /`)
- Privilege escalation (`sudo`, `su`, `chmod 777`, `mkfs`, `dd` to devices)
- Git history destruction (`git push --force`, `git reset --hard`)
- Remote script execution (`curl | sh`)
- Global install / publish (`npm i -g`, `pip install -g`, `npm publish`)
- Persistent backdoors (writing `.bashrc`/`.profile`), reading SSH keys, Docker cleanup, etc.

### Plan First
In `plan` mode, the Coder first outputs a structured markdown plan (goal / steps / files / risks). Write tools stay blocked until the user approves the plan in the UI approval panel, preventing the AI from going off track.

### Workspace Management
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
git clone https://github.com/hysonwang/ai-cowork.git ai-cowork
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
| `PORT` | orchestrator port | 3001 |

## Tech Stack
- **Backend**: Fastify 4 + @fastify/websocket + @mariozechner/pi-coding-agent + zod
- **Frontend**: React 18 + Vite 5 + Zustand + Monaco Editor (code view)
- **Models**: Anthropic / OpenAI / DeepSeek etc. via pi-ai

## Contributing
Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev guide.

## License
[MIT](./LICENSE)
