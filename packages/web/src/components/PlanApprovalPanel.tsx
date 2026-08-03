import { useState, useMemo, useEffect } from "react";
import { useStore } from "../store";
import { sendAsync, genId } from "../ws";

/**
 * 计划审批面板。
 * 当 planState.phase === "proposing" 时以模态弹层展示 Coder 提出的计划，
 * 用户可 批准 / 拒绝 / 要求修改（带反馈）。
 * approved 后变为底部可折叠的「计划已批准」回看条；rejected/iterate 后面板关闭（清空 planState）。
 */

/** 极简 markdown 渲染：识别标题/列表/段落/粗体，其余按原文展示。不引外部库。 */
function renderPlanMarkdown(md: string) {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="plan-para">
          {inline(para.join(" "))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="plan-ul">
          {listItems.map((it, i) => (
            <li key={i}>{inline(it)}</li>
          ))}
        </ul>,
      );
      listItems = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s+/.test(line)) {
      flushPara();
      flushList();
      const level = (line.match(/^#+/)![0]).length;
      const text = line.replace(/^#+\s*/, "");
      const Tag = (`h${Math.min(level + 2, 6)}`) as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag key={`h-${blocks.length}`} className={`plan-h plan-h${level}`}>
          {inline(text)}
        </Tag>,
      );
    } else if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushPara();
      listItems.push(line.replace(/^\s*(?:[-*+]|\d+\.)\s*/, ""));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** 行内粗体 **x** 与代码 `x` */
function inline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function PlanApprovalPanel() {
  const planState = useStore((s) => s.planState);
  const sessionId = useStore((s) => s.sessionId);
  const [mode, setMode] = useState<"buttons" | "iterate">("buttons");
  const [feedback, setFeedback] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  // ★ B8 防重入：决策发出后立即禁用所有按钮，避免连点触发多次 plan.approve
  const [submitting, setSubmitting] = useState(false);

  // ★ BUG 修复：组件在 App.tsx 常驻渲染（sessionId 存在即挂载），planState 变 null 时
  //   只 return null 不卸载，React 保留 state。第一次提案 submitting=true 后计划消失，
  //   第二次提案 submitting 仍为 true → 按钮永久禁用。mode/feedback 同理残留。
  //   修复：planState 变化时（新提案/变 approved/被清空）重置本地状态。
  useEffect(() => {
    setSubmitting(false);
    setMode("buttons");
    setFeedback("");
  }, [planState]);

  // ★ B13 修正 useMemo 依赖：用 planState 整体（而非可选链 planState?.plan），
  //   避免 lint 警告和严格模式下漏更新
  const blocks = useMemo(
    () => (planState ? renderPlanMarkdown(planState.plan) : null),
    [planState],
  );

  if (!planState || !sessionId) return null;

  // approved：变成底部可折叠回看条
  if (planState.phase === "approved") {
    return (
      <div className="plan-approved-bar">
        <button
          className="plan-collapse-toggle"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "▶" : "▼"} ✅ 计划已批准，Coder 执行中
        </button>
        {!collapsed && (
          <div className="plan-approved-detail">
            <div className="plan-summary">{planState.summary}</div>
            <div className="plan-md">{blocks}</div>
          </div>
        )}
      </div>
    );
  }

  // proposing：模态弹层
  const sendDecision = async (decision: "approved" | "rejected" | "iterate", fb?: string) => {
    if (submitting) return; // 防重入
    setSubmitting(true);
    // ★ BUG 修复：之前用 send（静默丢弃），ws 断开时命令丢失、submitting 永远 true、模态卡死。
    //   改用 sendAsync：ws 断开或服务端报错时 reject，catch 里重置 submitting 并提示用户。
    try {
      await sendAsync({
        id: genId(),
        type: "plan.approve",
        sessionId,
        decision,
        feedback: fb,
      });
      setMode("buttons");
      setFeedback("");
    } catch (err) {
      setSubmitting(false);
      alert("操作失败：" + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="plan-overlay">
      <div className="plan-modal">
        <div className="plan-modal-header">
          <span className="plan-modal-title">📋 计划待批准</span>
          <span className="plan-modal-subtitle">{planState.summary}</span>
        </div>

        <div className="plan-md plan-md-scroll">{blocks}</div>

        {mode === "iterate" ? (
          <div className="plan-iterate">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="请输入对计划的修改建议（例如：先做登录页、跳过测试、改用 Tailwind…）"
              rows={3}
              autoFocus
              disabled={submitting}
            />
            <div className="plan-iterate-btns">
              <button
                className="plan-btn plan-iterate-confirm"
                onClick={() => sendDecision("iterate", feedback.trim() || undefined)}
                disabled={!feedback.trim() || submitting}
              >
                {submitting ? "提交中…" : "提交修改意见"}
              </button>
              <button
                className="plan-btn plan-btn-cancel"
                onClick={() => {
                  setMode("buttons");
                  setFeedback("");
                }}
                disabled={submitting}
              >
                返回
              </button>
            </div>
          </div>
        ) : (
          <div className="plan-actions">
            <button
              className="plan-btn plan-btn-approve"
              onClick={() => sendDecision("approved")}
              disabled={submitting}
            >
              {submitting ? "处理中…" : "✅ 批准并执行"}
            </button>
            <button
              className="plan-btn plan-btn-iterate"
              onClick={() => setMode("iterate")}
              disabled={submitting}
            >
              🔁 要求修改
            </button>
            <button
              className="plan-btn plan-btn-reject"
              onClick={() => sendDecision("rejected")}
              disabled={submitting}
            >
              ❌ 拒绝重规划
            </button>
          </div>
        )}

        <div className="plan-hint">
          批准后 Coder 将解锁 write/edit/bash 工具开始执行；拒绝/修改后 Coder 保持只读并重新输出计划。
        </div>
      </div>
    </div>
  );
}
