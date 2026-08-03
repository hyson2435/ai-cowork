import { useState } from "react";
import { useStore } from "../store";
import { sendAsync, genId } from "../ws";
import type { CheckpointInfo } from "@ai-cowork/shared";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function CheckpointPanel() {
  const sessionId = useStore((s) => s.sessionId)!;
  const checkpoints = useStore((s) => s.checkpoints);
  const setCheckpoints = useStore((s) => s.setCheckpoints);
  const isStreaming = useStore((s) => s.isStreaming);

  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const create = async () => {
    if (!sessionId) return;
    setBusy("create");
    try {
      await sendAsync({
        id: genId(),
        type: "checkpoint.create",
        sessionId,
        label: label.trim() || undefined,
      });
      // ★ BUG 修复：移除 addCheckpointLocal（闭包陈旧会覆盖并发事件期间新增的 cp）。
      //   服务端会广播 checkpoint.created 事件 → store.addCheckpoint（已去重），
      //   这里不再本地操作 checkpoints，避免与事件竞争。
      setLabel("");
    } catch (err) {
      alert("创建快照失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    if (!sessionId) return;
    setBusy("list");
    try {
      const list = (await sendAsync({
        id: genId(),
        type: "checkpoint.list",
        sessionId,
      })) as CheckpointInfo[];
      setCheckpoints(list);
    } catch (err) {
      alert("刷新失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (cpId: string) => {
    if (!sessionId) return;
    const ok = confirm("确认回滚到此 checkpoint？当前未保存的工作区变更会丢失。");
    if (!ok) return;
    setBusy(cpId);
    try {
      await sendAsync({
        id: genId(),
        type: "checkpoint.rollback",
        sessionId,
        checkpointId: cpId,
      });
      // 事件里会刷新文件树；顺便也刷新 checkpoint 列表（当前逻辑下不变，但保险起见）
      void refresh();
    } catch (err) {
      alert("回滚失败：" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="checkpoint-panel">
      <div className="panel-header">
        <span className="panel-title">Checkpoints</span>
        <button
          className="refresh"
          onClick={refresh}
          disabled={busy === "list"}
          title="刷新列表"
        >
          {busy === "list" ? "加载中…" : "刷新"}
        </button>
      </div>

      <div className="create-row">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="快照描述（可选）"
          disabled={busy !== null}
        />
        <button
          className="create"
          onClick={create}
          disabled={busy !== null}
        >
          {busy === "create" ? "创建中…" : "创建快照"}
        </button>
      </div>

      <div className="cp-list">
        {checkpoints.length === 0 ? (
          <div className="empty">还没有快照。可以在修改前先创建快照，方便回滚。</div>
        ) : (
          checkpoints.map((cp) => (
            <div key={cp.id} className={`cp-item ${busy === cp.id ? "busy" : ""}`}>
              <div className="cp-info">
                <div className="cp-title">
                  {cp.label || <span className="cp-id">#{cp.id.slice(0, 8)}</span>}
                </div>
                <div className="cp-meta">
                  {formatTime(cp.createdAt)}
                  {cp.fileCount !== undefined && (
                    <span className="cp-count"> · {cp.fileCount} 个文件</span>
                  )}
                </div>
              </div>
              <button
                className="rollback"
                onClick={() => rollback(cp.id)}
                disabled={busy !== null || isStreaming}
                title={isStreaming ? "Agent 工作中，请先停止或等待" : "回滚到此快照"}
              >
                {busy === cp.id ? "回滚中…" : "回滚"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
