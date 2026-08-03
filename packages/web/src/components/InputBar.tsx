import { useState, useEffect, useRef } from "react";
import { useStore } from "../store";
import { send, sendAsync, genId } from "../ws";

export function InputBar() {
  const sessionId = useStore((s) => s.sessionId)!;
  const isStreaming = useStore((s) => s.isStreaming);
  const connected = useStore((s) => s.connected);
  const append = useStore((s) => s.append);
  const [msg, setMsg] = useState("");
  const [aborting, setAborting] = useState(false);
  // ★ 保存 abort 兜底 timer，卸载时清理，避免对已卸载组件 setState
  const abortTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // abort 完成后 (agent_end 会让 isStreaming=false)，重置 aborting
  useEffect(() => {
    if (!isStreaming && aborting) setAborting(false);
  }, [isStreaming, aborting]);

  // ★ 卸载时清理 abort 兜底 timer
  useEffect(() => {
    return () => {
      if (abortTimerRef.current) clearTimeout(abortTimerRef.current);
    };
  }, []);

  const submit = (kind: "steer" | "follow_up") => {
    if (!msg.trim()) return;
    // ★ BUG 修复：ws 断开时 send 静默丢弃，但这里仍显示"已排队"会误导用户。
    //   未连接时不发送，提示连接已断开。
    if (!connected) {
      append({ kind: "lifecycle", type: "⚠️ 未连接到服务器，消息未发送，等待重连后重试", ts: Date.now() });
      return;
    }
    send({ id: genId(), type: kind, sessionId, message: msg });
    // 即时反馈：在日志里显示已排队
    if (kind === "steer") {
      append({ kind: "lifecycle", agent: "coder", type: `📝 Steer 已排队: "${msg.trim().slice(0, 80)}"（将在下一个工具边界注入）`, ts: Date.now() });
    } else {
      append({ kind: "lifecycle", type: `📋 Follow-up 已排队: "${msg.trim().slice(0, 80)}"（将在本轮结束后消费）`, ts: Date.now() });
    }
    setMsg("");
  };

  const prompt = () => {
    if (!msg.trim()) return;
    if (!connected) {
      append({ kind: "lifecycle", type: "⚠️ 未连接到服务器，消息未发送", ts: Date.now() });
      return;
    }
    send({
      id: genId(),
      type: "prompt",
      sessionId,
      message: msg,
      streamingBehavior: isStreaming ? "steer" : undefined,
    });
    setMsg("");
  };

  const abort = async () => {
    // ★ BUG 修复：之前用 send（静默丢弃），ws 断开时 abort 命令丢失、agent 不停止、
    //   isStreaming 永远 true、aborting 永远 true，按钮卡在"正在停止…"。
    //   改用 sendAsync：ws 断开时 reject，finally 重置 aborting；
    //   服务端确认 abort 后 agent_end 会让 isStreaming=false，effect 也会重置。
    append({ kind: "lifecycle", agent: "coder", type: "⏹ 正在停止 Agent…", ts: Date.now() });
    setAborting(true);
    try {
      await sendAsync({ id: genId(), type: "abort", sessionId });
    } catch {
      // ws 断开等场景：aborting 会被 finally 重置，用户可重试或等重连
    } finally {
      // 注意：不在此处立刻 setAborting(false)。
      //   abort 成功后 agent_end → isStreaming=false → effect 会重置 aborting；
      //   但若 ws 断开导致永远收不到 agent_end，需兜底重置，否则按钮永久禁用。
      //   用 3s 超时兜底（agent 正常停止通常 < 3s）。
      if (abortTimerRef.current) clearTimeout(abortTimerRef.current);
      abortTimerRef.current = setTimeout(() => setAborting(false), 3000);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      isStreaming ? submit("steer") : prompt();
    }
  };

  return (
    <div className="input-bar">
      <textarea
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        onKeyDown={onKey}
        rows={3}
        placeholder={
          isStreaming
            ? "输入消息注入… (Steer 在工具边界插入，不会立即停止。要立即停止请点「停止」)"
            : "输入新指令…"
        }
      />
      <div className="btns">
        {isStreaming && (
          <button
            className="abort-btn"
            onClick={abort}
            disabled={aborting}
          >
            {aborting ? "正在停止…" : "⏹ 停止"}
          </button>
        )}
        {isStreaming ? (
          <button className="steer" onClick={() => submit("steer")} disabled={!msg.trim()}>
            Steer (注入消息)
          </button>
        ) : (
          <button className="prompt" onClick={prompt} disabled={!msg.trim()}>
            发送
          </button>
        )}
        <button
          className="followup"
          onClick={() => submit("follow_up")}
          disabled={!msg.trim()}
        >
          Follow-up (排队)
        </button>
      </div>
      <div className="hint">
        {isStreaming
          ? "⏹停止 = 立即中止 · Steer = 注入消息但不停止 · ⌘/Ctrl+Enter = Steer"
          : "⌘/Ctrl+Enter 发送"}
      </div>
    </div>
  );
}
