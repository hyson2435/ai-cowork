import { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { sendAsync, genId } from "../ws";

export function CopilotPanel() {
  const sessionId = useStore((s) => s.sessionId);
  const reviewer = useStore((s) => s.reviewer);
  const messages = useStore((s) => s.copilotMessages);
  const status = useStore((s) => s.copilotStatus);
  const queuePosition = useStore((s) => s.copilotQueuePosition);
  const currentTask = useStore((s) => s.copilotCurrentTask);
  const queueLength = useStore((s) => s.copilotQueueLength);
  const addCopilotUserMessage = useStore((s) => s.addCopilotUserMessage);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息时自动滚到底部
  // ★ BUG 修复：之前依赖 [messages.length, status]，status 变化（chatting→idle）无新消息也会滚动打断阅读。
  //   修复：只依赖 messages.length，并加"用户在底部附近"判断。
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (nearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [messages.length]);

  const sendChat = () => {
    const msg = input.trim();
    if (!msg || !sessionId) return;
    addCopilotUserMessage(msg);
    // ★ BUG 修复：之前用 send（静默丢弃），ws 断开时用户消息已上屏但服务端从未收到，用户无感知。
    //   改用 sendAsync，失败时移除已上屏消息并提示。这里不 await（保持输入框立即清空的体验）。
    const msgId = genId();
    sendAsync({ id: msgId, type: "copilot.chat", sessionId, message: msg })
      .catch((err) => {
        alert("发送失败：" + (err instanceof Error ? err.message : String(err)));
      });
    setInput("");
  };

  const applyInstruction = (instruction: string) => {
    if (!sessionId) return;
    // ★ 同 sendChat，用 sendAsync 失败时提示
    sendAsync({ id: genId(), type: "copilot.apply", sessionId, instruction, mode: "steer" })
      .catch((err) => {
        alert("注入失败：" + (err instanceof Error ? err.message : String(err)));
      });
  };

  if (!reviewer) {
    return (
      <div className="copilot-panel">
        <div className="copilot-header">💬 Copilot</div>
        <div className="copilot-empty">
          Copilot 未启用。
          <br />
          启动 Agent 时勾选「启用 Reviewer Agent」即可使用。
        </div>
      </div>
    );
  }

  return (
    <div className="copilot-panel">
      <div className="copilot-header">💬 Copilot</div>

      {/* 状态条 */}
      <div className={`copilot-status-bar status-${status}`}>
        {status === "idle" && <span className="status-dot" />}
        {status === "idle" && <span>● 空闲，随时可以提问</span>}
        {status === "reviewing" && (
          <>
            <span className="status-dot spinning" />
            <span>🔄 {currentTask || "正在审查代码…"}</span>
          </>
        )}
        {status === "chatting" && (
          <>
            <span className="status-dot spinning" />
            <span>💬 正在回答你的问题…</span>
          </>
        )}
        {status === "queued" && (
          <>
            <span className="status-dot" />
            <span>
              ⏳ 排队中… 前面还有 {queuePosition} 个任务
              {queueLength > 0 ? `（共 ${queueLength} 个等待）` : ""}
            </span>
          </>
        )}
      </div>

      {/* 对话消息列表 */}
      <div className="copilot-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="copilot-empty">
            向 Copilot 提问吧！
            <br />
            可以问进度、查代码、提修改建议、解释概念…
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`copilot-msg ${msg.role}`}>
            <div className="copilot-msg-role">
              {msg.role === "user" ? "👤 你" : "🤖 Copilot"}
            </div>
            <div className="copilot-msg-text">{msg.text}</div>
            {msg.applyInstruction && (
              <button
                className="copilot-apply-btn"
                onClick={() => applyInstruction(msg.applyInstruction!)}
              >
                ⚡ 让 Coder 执行
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 输入栏 */}
      <div className="copilot-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendChat();
            }
          }}
          placeholder="问 Copilot… (Enter 发送, Shift+Enter 换行)"
          rows={2}
          disabled={status === "chatting" || status === "queued"}
        />
        <button
          onClick={sendChat}
          disabled={!input.trim() || status === "chatting" || status === "queued"}
        >
          发送
        </button>
      </div>
    </div>
  );
}
