/**
 * 把 pi-coding-agent 的 AgentSessionEvent 映射成前端友好的扁平 ServerEvent。
 * 屏蔽 assistantMessageEvent 等内部结构，前端只看 thinking_delta / text_delta / tool_* 等。
 *
 * M1 增强：从 write/edit/bash 工具事件派生 file.changed 与 terminal.* 事件。
 * 一个 pi 事件可能派生出多个 ServerEvent（如 tool_start 同时派生 tool_start + file.changed）。
 *
 * M3：多 Agent 角色 — mapEvent 增加 agent 参数（"coder" 或 "reviewer"），所有派生事件带上 agent 角色。
 */
import { readFile } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { ServerEvent, FileChangeKind, AgentRole } from "@ai-cowork/shared";

export interface BridgeContext {
  /** session 的 cwd，用于把 tool args 里的相对 path 解析成绝对路径读最终内容 */
  cwd: string;
}

export function mapEvent(
  sessionId: string,
  e: AgentSessionEvent,
  ctx: BridgeContext,
  agent: AgentRole = "coder",
): ServerEvent[] {
  switch (e.type) {
    case "agent_start":
      return [{ sessionId, type: "agent_start", agent }];
    case "agent_end":
      return [{ sessionId, type: "agent_end", agent }];
    case "turn_start":
      return [{ sessionId, type: "turn_start", agent }];
    case "turn_end": {
      // ★ pi 没有 error 事件，错误通过 turn_end.message.stopReason === "error" 传递
      //   之前没读 stopReason，错误信息被吞掉，前端只看到生命周期事件快速结束（"没反应"）
      const msg = e.message as { stopReason?: string; errorMessage?: string } | undefined;
      if (msg?.stopReason === "error" || msg?.stopReason === "aborted") {
        const errMsg = msg.errorMessage ?? "(no error message)";
        return [
          { sessionId, type: "turn_end", agent },
          {
            sessionId,
            agent,
            type: "error",
            code: "E_TURN",
            message: msg.stopReason === "aborted" ? `Agent aborted: ${errMsg}` : `Agent error: ${errMsg}`,
          },
        ];
      }
      return [{ sessionId, type: "turn_end", agent }];
    }
    case "message_start":
      return [{ sessionId, type: "message_start", agent, role: (e.message as { role?: string })?.role ?? "assistant" }];
    case "message_end":
      return [{ sessionId, type: "message_end", agent }];
    case "message_update": {
      const ae = e.assistantMessageEvent;
      if (ae.type === "thinking_delta")
        return [{ sessionId, type: "thinking_delta", agent, contentIndex: ae.contentIndex, delta: ae.delta }];
      if (ae.type === "text_delta")
        return [{ sessionId, type: "text_delta", agent, contentIndex: ae.contentIndex, delta: ae.delta }];
      return [];
    }
    case "tool_execution_start": {
      const events: ServerEvent[] = [
        { sessionId, type: "tool_start", agent, toolCallId: e.toolCallId, toolName: e.toolName, args: e.args },
      ];
      // 派生 file.changed (write) / terminal.cmd (bash)
      const derived = deriveFromToolStart(sessionId, e.toolCallId, e.toolName, e.args, ctx, agent);
      events.push(...derived);
      return events;
    }
    case "tool_execution_update": {
      // bash 工具通过 update 事件流式推送输出
      if (e.toolName === "bash") {
        const partial = e.partialResult as { content?: Array<{ type: string; text?: string }> } | undefined;
        const text = partial?.content?.find((c) => c.type === "text")?.text;
        if (text) {
          return [{ sessionId, type: "terminal.output", agent, toolCallId: e.toolCallId, stream: "stdout", delta: text }];
        }
      }
      return [];
    }
    case "tool_execution_end": {
      const events: ServerEvent[] = [
        { sessionId, type: "tool_end", agent, toolCallId: e.toolCallId, toolName: e.toolName, isError: !!e.isError },
      ];
      // edit 工具：end 事件不带 args，从 start 缓存里取 path
      if (e.toolName === "edit" && !e.isError) {
        const cached = toolArgsCache.get(e.toolCallId);
        const args = cached?.args as { path?: string } | undefined;
        if (args?.path) {
          readFile(pathResolve(ctx.cwd, args.path), "utf-8")
            .then((content) => {
              pendingFileReads.push({ sessionId, path: args.path!, content, toolCallId: e.toolCallId, kind: "edit", agent });
              // ★ 触发兜底 flush：确保异步 readFile 完成后 pending 事件不被丢失
              scheduleFallbackFlush();
            })
            .catch(() => {});
        }
      }
      // bash 工具结束 → terminal.exit
      if (e.toolName === "bash") {
        const result = e.result as { exitCode?: number } | undefined;
        events.push({ sessionId, type: "terminal.exit", agent, toolCallId: e.toolCallId, exitCode: result?.exitCode ?? 0 });
      }
      toolArgsCache.delete(e.toolCallId);
      return events;
    }
    case "queue_update":
      return [{ sessionId, type: "queue_update", steering: [...e.steering], followUp: [...e.followUp] }];
    default:
      return [];
  }
}

/** edit 工具结束后异步读到的文件内容，由调用方在事件循环空闲时 flush 成 file.changed 事件 */
export interface PendingFileRead {
  sessionId: string;
  path: string;
  content: string;
  toolCallId: string;
  kind: FileChangeKind;
  agent: AgentRole;
}
export const pendingFileReads: PendingFileRead[] = [];

/** 缓存 tool_execution_start 时的 args，供 tool_execution_end 使用（end 事件不带 args） */
const toolArgsCache = new Map<string, { toolName: string; args: unknown }>();

function deriveFromToolStart(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: unknown,
  _ctx: BridgeContext,
  agent: AgentRole,
): ServerEvent[] {
  // 缓存 args 供 tool_execution_end 用
  toolArgsCache.set(toolCallId, { toolName, args });

  if (toolName === "write") {
    const a = args as { path?: string; content?: string } | undefined;
    if (a?.path) {
      return [
        { sessionId, type: "file.changed", agent, path: a.path, kind: "write", content: a.content, toolCallId },
      ];
    }
  }
  if (toolName === "bash") {
    const a = args as { command?: string } | undefined;
    if (a?.command) {
      return [{ sessionId, type: "terminal.cmd", agent, toolCallId, command: a.command }];
    }
  }
  return [];
}

/**
 * 把 pendingFileReads 里的内容转成 file.changed 事件并清空队列。
 * ★ BUG 修复：pendingFileReads 是 module 级全局数组，跨所有 session 共享。
 *   之前 flushPendingFileReads() 一次性排空全部，导致 session A 的 subscribe 回调
 *   会拿到 session B 的异步 readFile 结果，把 B 的文件加进 A 的 changedFiles，
 *   造成跨 session 污染 + B session 漏审。
 *   修复：传入 sessionId 时只取并移除该 session 的 pending，不传则排空全部（兜底用）。
 */
export function flushPendingFileReads(sessionId?: string): Array<Omit<PendingFileRead, "agent"> & { agent: AgentRole }> {
  if (pendingFileReads.length === 0) return [];
  if (sessionId) {
    const mine: PendingFileRead[] = [];
    const others: PendingFileRead[] = [];
    for (const p of pendingFileReads) {
      if (p.sessionId === sessionId) mine.push(p);
      else others.push(p);
    }
    if (mine.length === 0) return [];
    // 重建数组只保留其他 session 的
    pendingFileReads.length = 0;
    for (const o of others) pendingFileReads.push(o);
    return mine;
  }
  // 不传 sessionId：排空全部（兜底 flush 用）
  const out = [...pendingFileReads];
  pendingFileReads.length = 0;
  return out;
}

// ★ flush 兜底定时器：edit 工具的 readFile 是异步的，可能在最后一个 pi 事件
//   （如 agent_end）flush 之后才完成 push，导致 file.changed 事件丢失。
//   每次 push 时启 0ms timer，确保下一 tick 一定再 flush 一次。
//   旧的设计只在 subscribe 回调末尾 flush，turn 短时 readFile 来不及就会丢事件。
let flushSubscriber: ((events: Array<Omit<PendingFileRead, "agent"> & { agent: AgentRole }>) => void) | null = null;

/** 注册 flush 回调（由 SessionRegistry 启动时注册，用于把 pending 事件广播出去） */
export function registerPendingFlushSubscriber(
  cb: (events: Array<Omit<PendingFileRead, "agent"> & { agent: AgentRole }>) => void,
): void {
  flushSubscriber = cb;
}

/** schedule 一次兜底 flush（push 后调用，确保异步 readFile 完成后能被 flush） */
function scheduleFallbackFlush(): void {
  setTimeout(() => {
    const pending = flushPendingFileReads();
    if (pending.length > 0 && flushSubscriber) {
      flushSubscriber(pending);
    }
  }, 0);
}
