import { useState } from "react";
import { useStore } from "./store";
import { sendAsync, genId } from "./ws";
import { ThoughtStream } from "./components/ThoughtStream";
import { InputBar } from "./components/InputBar";
import { FileTree } from "./components/FileTree";
import { CodeView } from "./components/CodeView";
import { Terminal } from "./components/Terminal";
import { CheckpointPanel } from "./components/CheckpointPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { CopilotPanel } from "./components/CopilotPanel";
import { PlanApprovalPanel } from "./components/PlanApprovalPanel";

export default function App() {
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const model = useStore((s) => s.model);
  const isStreaming = useStore((s) => s.isStreaming);
  const steeringCount = useStore((s) => s.steeringCount);
  const followUpCount = useStore((s) => s.followUpCount);
  const reviewer = useStore((s) => s.reviewer);
  const permissionMode = useStore((s) => s.permissionMode);
  const planPhase = useStore((s) => s.planState?.phase);
  const setFiles = useStore((s) => s.setFiles);

  const [cwd, setCwd] = useState("/tmp/aicowork-preview");
  const [prompt, setPrompt] = useState("用 HTML+CSS+JS 做一个落地页，包含标题、按钮、简单样式");
  const [modelSpec, setModelSpec] = useState("deepseek/deepseek-chat");
  const [startReview, setStartReview] = useState(true);
  const [bottomTab, setBottomTab] = useState<"terminal" | "preview" | "thoughts">("terminal");
  const [permissionModeChoice, setPermissionModeChoice] = useState<"free" | "read-only" | "plan">("free");

  const start = async () => {
    // ★ BUG 修复：start 失败（ws 断开/服务端 error）时 sendAsync reject 无人处理，
    //   触发 unhandledrejection 且用户无反馈。加 try/catch + alert。
    //   同时启动新 session 前调用 clear() 重置状态，避免残留上一 session 数据。
    try {
      useStore.getState().clear();
      const data = (await sendAsync({
        id: genId(),
        type: "session.start",
        cwd,
        prompt,
        model: modelSpec || undefined,
        review: startReview,
        permissionMode: permissionModeChoice,
      })) as { sessionId: string; reviewer?: boolean };
      // 拉取初始文件树
      try {
        const files = await sendAsync({ id: genId(), type: "file.list", sessionId: data.sessionId });
        setFiles(files as never);
      } catch {
        // 忽略
      }
    } catch (err) {
      alert("启动 Agent 失败：" + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="app">
      <header>
        <span className={`dot ${connected ? "on" : ""}`} />
        {connected ? "已连接" : "未连接"}
        {sessionId && (
          <>
            {" · session "}
            <code>{sessionId.slice(0, 8)}</code>
            {model && <span className="model"> · {model}</span>}
            {reviewer && <span className="badge reviewer-badge">👀 Reviewer ON</span>}
            {permissionMode !== "free" && <span className={`badge perm-badge perm-${permissionMode}`}>🔒 {permissionMode}</span>}
            {planPhase === "proposing" && <span className="badge plan-pending-badge">📋 计划待批准</span>}
            {planPhase === "approved" && <span className="badge plan-approved-badge">✅ 计划执行中</span>}
          </>
        )}
        {isStreaming && <span className="streaming">思考中…</span>}
        {(steeringCount > 0 || followUpCount > 0) && (
          <span className="queue">
            队列: steer {steeringCount} / followUp {followUpCount}
          </span>
        )}
      </header>

      {!sessionId && (
        <div className="start-form">
          <label>
            工作目录 (cwd)
            <input value={cwd} onChange={(e) => setCwd(e.target.value)} />
          </label>
          <label>
            模型 (如 deepseek/deepseek-chat)
            <input value={modelSpec} onChange={(e) => setModelSpec(e.target.value)} placeholder="留空用默认" />
          </label>
          <label>
            初始任务
            <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={startReview}
              onChange={(e) => setStartReview(e.target.checked)}
            />
            启用 Reviewer Agent（自动审查代码，严重问题会 follow_up 注入修复）
          </label>
          <label>
            权限模式（安全防护）
            <select value={permissionModeChoice} onChange={(e) => setPermissionModeChoice(e.target.value as "free" | "read-only" | "plan")}>
              <option value="free">free — 全开（默认，拦截 rm -rf/sudo 等高危命令）</option>
              <option value="read-only">read-only — 只读（禁用 write/edit/bash，仅查看）</option>
              <option value="plan">plan — 计划模式（只读，先出方案待批准）</option>
            </select>
          </label>
          <button onClick={start} disabled={!connected}>
            启动 Agent
          </button>
          {!connected && <p className="hint">等待连接 orchestrator…</p>}
        </div>
      )}

      {sessionId && (
        <div className="main">
          <div className="left-pane">
            <FileTree />
            <CheckpointPanel />
          </div>
          <div className="center-pane">
            <div className="center-top">
              <CodeView />
            </div>
            <div className="center-bottom">
              <div className="bottom-tabs">
                <button
                  className={`tab ${bottomTab === "terminal" ? "active" : ""}`}
                  onClick={() => setBottomTab("terminal")}
                >
                  终端
                </button>
                <button
                  className={`tab ${bottomTab === "preview" ? "active" : ""}`}
                  onClick={() => setBottomTab("preview")}
                >
                  预览
                </button>
                <button
                  className={`tab ${bottomTab === "thoughts" ? "active" : ""}`}
                  onClick={() => setBottomTab("thoughts")}
                >
                  思考流
                </button>
              </div>
              <div className="tab-content">
                {bottomTab === "terminal" && <Terminal />}
                {bottomTab === "preview" && <PreviewPanel />}
                {bottomTab === "thoughts" && <ThoughtStream />}
              </div>
            </div>
          </div>
          <div className="right-pane">
            <CopilotPanel />
          </div>
          <div className="input-area">
            <InputBar />
          </div>
        </div>
      )}

      {/* plan 模式：计划审批模态 / 已批准回看条 */}
      {sessionId && <PlanApprovalPanel />}
    </div>
  );
}
