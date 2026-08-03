import { useState, useEffect } from "react";
import { useStore } from "../store";
import { send, genId } from "../ws";

export function InputBar() {
  const sessionId = useStore((s) => s.sessionId)!;
  const isStreaming = useStore((s) => s.isStreaming);
  const append = useStore((s) => s.append);
  const [msg, setMsg] = useState("");
  const [aborting, setAborting] = useState(false);

  // abort 完成后 (agent_end 会让 isStreaming=false)，重置 aborting
  useEffect(() => {
    if (!isStreaming && aborting) setAborting(false);
  }, [isStreaming, aborting]);

  const submit = (kind: "steer" | "follow_up") => {
    if (!msg.trim()) return;
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
    send({
      id: genId(),
      type: "prompt",
      sessionId,
      message: msg,
      streamingBehavior: isStreaming ? "steer" : undefined,
    });
    setMsg("");
  };

  const abort = () => {
    send({ id: genId(), type: "abort", sessionId });
    setAborting(true);
    append({ kind: "lifecycle", agent: "coder", type: "⏹ 正在停止 Agent…", ts: Date.now() });
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
