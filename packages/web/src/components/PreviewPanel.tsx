import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useStore } from "../store";
import { sendAsync, genId } from "../ws";
import type { PreviewInfo } from "@ai-cowork/shared";

/**
 * 根据当前 store 的 sessionId + preview.port，构造浏览器可访问的预览 URL。
 * 三种部署形态：
 *  1. dev 本地直连：web 是 localhost:3002，orch 是 3001 → vite proxy 已把 /preview/* -> 3001，直接拼路径
 *  2. 预览代理下：URL 是 https://<trae-preview-host>/ → 相对路径 /preview/... 也走同源，没问题
 *  3. 生产同域部署：同样 /preview/... 同源
 * 所以统一用相对路径即可，不需要拼 host。
 */
function buildPreviewBasePath(info: PreviewInfo): string {
  return `/preview/${info.sessionId}/`;
}

export function PreviewPanel() {
  const sessionId = useStore((s) => s.sessionId)!;
  const files = useStore((s) => s.files);
  const preview = useStore((s) => s.preview);
  const previewRev = useStore((s) => s.previewRev);

  const [entry, setEntry] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [openExternal, setOpenExternal] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // 候选入口文件：index.html、dist/index.html、其他 html
  const entryCandidates = useMemo(() => {
    const htmls = files
      .filter((f) => f.type === "file" && f.name.toLowerCase().endsWith(".html"))
      .map((f) => f.path);
    const preferred = ["index.html", "dist/index.html", "public/index.html"];
    const result: string[] = [];
    for (const p of preferred) {
      if (htmls.includes(p)) result.push(p);
    }
    for (const h of htmls) {
      if (!result.includes(h)) result.push(h);
    }
    return result;
  }, [files]);

  const start = useCallback(async (entryFile?: string) => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await sendAsync({
        id: genId(),
        type: "preview.start",
        sessionId,
        entry: entryFile || entry || undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [sessionId, entry]);

  // 检测到有 index.html 且 preview 未启动 → 自动启一次（不阻塞，失败就静默）
  // ★ B15 修正：start 和 busy 加入依赖，避免 stale closure 和并发触发
  useEffect(() => {
    if (preview || busy) return;
    if (!entryCandidates.includes("index.html")) return;
    const id = setTimeout(() => {
      start("index.html").catch(() => {});
    }, 800);
    return () => clearTimeout(id);
  }, [sessionId, preview, busy, entryCandidates, start]);

  const stop = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await sendAsync({ id: genId(), type: "preview.stop", sessionId });
    } finally {
      setBusy(false);
    }
  };

  const refresh = () => {
    // bumpPreviewRev 由 preview.updated 事件驱动；手动刷新直接调用 iframe reload
    iframeRef.current?.contentWindow?.location.reload();
  };

  const src = useMemo(() => {
    if (!preview) return "";
    const base = buildPreviewBasePath(preview);
    // ★ B14 清理死代码：原 `${entryPath || preview.entry ? "" : ""}` 三元两边都是空串，是无意义表达式
    //   最终效果等价于直接拼 base + entryPath（去掉前导斜杠）+ ?_rev=N
    const entryPath = preview.entry || "";
    return `${base}${entryPath.replace(/^\/+/, "")}?_rev=${previewRev}`;
  }, [preview, previewRev]);

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="tabs-left">
          {preview ? (
            <span className="status running">● 预览运行中</span>
          ) : (
            <span className="status stopped">○ 预览未启动</span>
          )}
          <select
            className="entry-select"
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            disabled={busy}
            title="选择入口 HTML 文件"
          >
            <option value="">（根路径 /，默认 index.html）</option>
            {entryCandidates.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="tabs-right">
          {!preview ? (
            <button
              className="start-prev"
              onClick={() => start()}
              disabled={busy}
            >
              {busy ? "启动中…" : "启动预览"}
            </button>
          ) : (
            <>
              <button className="refresh" onClick={refresh} disabled={busy} title="手动刷新 iframe">
                刷新
              </button>
              <a
                className="ext-link"
                href={src}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!preview) {
                    e.preventDefault();
                    return;
                  }
                  setOpenExternal(true);
                  setTimeout(() => setOpenExternal(false), 2000);
                }}
                title={openExternal ? "已在新标签打开" : "新标签页打开"}
              >
                {openExternal ? "✓ 已打开" : "↗ 新标签"}
              </a>
              <button
                className="stop-prev"
                onClick={stop}
                disabled={busy}
              >
                停止
              </button>
            </>
          )}
        </div>
      </div>
      <div className="preview-body">
        {!preview ? (
          <div className="preview-empty">
            <div className="empty-title">启动预览即可查看当前页面效果</div>
            <div className="empty-tip">
              {entryCandidates.length === 0
                ? "当前工作区还没有 HTML 文件。让 Agent 先生成一个 landing page 吧。"
                : `检测到 ${entryCandidates.length} 个 HTML 文件，入口默认 ${entryCandidates[0] ?? "index.html"}`}
            </div>
            <button
              className="start-prev big"
              onClick={() => start(entryCandidates[0] || undefined)}
              disabled={busy || entryCandidates.length === 0}
            >
              {busy ? "启动中…" : `启动预览${entryCandidates[0] ? `（${entryCandidates[0]}）` : ""}`}
            </button>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            title="preview"
            className="preview-frame"
            src={src}
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}
