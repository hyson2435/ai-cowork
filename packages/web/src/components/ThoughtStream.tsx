import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type LogEntry } from "../store";
import type { AgentRole } from "@ai-cowork/shared";

const AGENT_LABEL: Record<AgentRole, string> = {
  coder: "Coder",
  reviewer: "Reviewer",
  copilot: "Copilot",
};

type AgentFilter = "all" | AgentRole;
type KindFilter = "all" | "thought" | "tool" | "review" | "error" | "lifecycle" | "blocked";

const KIND_LABELS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "thought", label: "思考/文本" },
  { key: "tool", label: "工具" },
  { key: "review", label: "审查" },
  { key: "error", label: "错误" },
  { key: "blocked", label: "拦截" },
  { key: "lifecycle", label: "生命周期" },
];

/** 提取一条日志的可搜索文本 */
function searchableText(e: LogEntry): string {
  switch (e.kind) {
    case "thinking":
    case "text":
      return e.text;
    case "tool_start":
      return `${e.toolName} ${JSON.stringify(e.args)}`;
    case "tool_end":
      return e.toolName;
    case "error":
      return e.message;
    case "review":
      return `${e.summary} ${(e.reviewed || []).join(" ")}`;
    case "blocked":
      return `${e.rule} ${e.command} ${e.mode}`;
    case "lifecycle":
      return e.type;
    case "queue":
      return `queue steer=${e.steering} followUp=${e.followUp}`;
  }
}

/** 提取日志的 agent（queue 类无 agent，返回 undefined） */
function agentOf(e: LogEntry): AgentRole | undefined {
  return "agent" in e ? e.agent : undefined;
}

/** 判断一条日志的 kind 归类 */
function kindOf(e: LogEntry): KindFilter {
  switch (e.kind) {
    case "thinking":
    case "text":
      return "thought";
    case "tool_start":
    case "tool_end":
      return "tool";
    case "review":
      return "review";
    case "error":
      return "error";
    case "blocked":
      return "blocked";
    case "lifecycle":
    case "queue":
      return "lifecycle";
  }
}

export function ThoughtStream() {
  const log = useStore((s) => s.log);
  const endRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return log.filter((e) => {
      if (agentFilter !== "all" && agentOf(e) !== agentFilter) return false;
      if (kindFilter !== "all" && kindOf(e) !== kindFilter) return false;
      if (q && !searchableText(e).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [log, search, agentFilter, kindFilter]);

  // ★ BUG 修复：之前依赖 [log]，即使新日志被 filter 过滤掉也会 scrollIntoView 打断阅读，
  //   且 smooth 动画在 thinking_delta 高频到达时叠加卡顿。
  //   修复：依赖 filtered，用容器级 scrollTop，只在用户已在底部附近时才自动滚。
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
    if (nearBottom) {
      stream.scrollTop = stream.scrollHeight;
    }
  }, [filtered]);

  return (
    <div className="thought-stream">
      <div className="thought-toolbar">
        <input
          className="thought-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索日志…"
        />
        <div className="thought-filters">
          {(["all", "coder", "reviewer", "copilot"] as AgentFilter[]).map((a) => (
            <button
              key={a}
              className={`filter-btn ${agentFilter === a ? "active" : ""} ${a !== "all" ? `agent-${a}` : ""}`}
              onClick={() => setAgentFilter(a)}
            >
              {a === "all" ? "全部" : AGENT_LABEL[a]}
            </button>
          ))}
        </div>
        <div className="thought-filters">
          {KIND_LABELS.map((k) => (
            <button
              key={k.key}
              className={`filter-btn kind ${kindFilter === k.key ? "active" : ""}`}
              onClick={() => setKindFilter(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="thought-count">
          {filtered.length}{filtered.length !== log.length ? `/${log.length}` : ""} 条
        </div>
      </div>
      <div className="stream" ref={streamRef}>
        {filtered.length === 0 && (
          <div className="empty">{log.length === 0 ? "等待 Agent 输出…" : "无匹配日志"}</div>
        )}
        {filtered.map((e, i) => (
          <Entry key={i} e={e} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

function AgentTag({ agent }: { agent: AgentRole }) {
  return <span className={`agent-tag agent-${agent}`}>{AGENT_LABEL[agent]}</span>;
}

function Entry({ e }: { e: LogEntry }) {
  switch (e.kind) {
    case "thinking":
      return (
        <div className="e thinking">
          <AgentTag agent={e.agent} />
          <span className="tag">思考</span>
          <pre>{e.text}</pre>
        </div>
      );
    case "text":
      return (
        <div className="e text">
          <AgentTag agent={e.agent} />
          <pre>{e.text}</pre>
        </div>
      );
    case "tool_start":
      return (
        <div className="e tool">
          <AgentTag agent={e.agent} />
          🔧 {e.toolName}{" "}
          <code>{JSON.stringify(e.args).slice(0, 160)}</code>
        </div>
      );
    case "tool_end":
      return (
        <div className="e tool-end">
          <AgentTag agent={e.agent} />
          ↳ {e.toolName} {e.isError ? "❌" : "✅"}
        </div>
      );
    case "lifecycle":
      return (
        <div className="e lifecycle">
          {e.agent && <AgentTag agent={e.agent} />}
          <span>— {e.type} —</span>
        </div>
      );
    case "queue":
      return (
        <div className="e queue">
          队列更新: steer={e.steering} followUp={e.followUp}
        </div>
      );
    case "error":
      return (
        <div className="e error">
          {e.agent && <AgentTag agent={e.agent} />}
          ⚠ {e.message}
        </div>
      );
    case "review":
      return (
        <div className={`e review ${e.severe ? "severe" : "mild"}`}>
          <span className="tag review-tag">
            {e.severe ? "🚨 Review（严重）" : "✅ Review"}
          </span>
          <pre>{e.summary}</pre>
          {e.reviewed && e.reviewed.length > 0 && (
            <div className="reviewed-files">
              审查文件:
              <ul>
                {e.reviewed.map((f, i) => <li key={i}><code>{f}</code></li>)}
              </ul>
            </div>
          )}
        </div>
      );
    case "blocked":
      return (
        <div className="e blocked">
          <span className="tag blocked-tag">🛑 权限拦截</span>
          <span className="blocked-rule">规则: {e.rule}</span>
          <code className="blocked-cmd">{e.command}</code>
          <span className="blocked-mode">模式: {e.mode}</span>
        </div>
      );
  }
}
