import { useEffect, useRef } from "react";
import { useStore } from "../store";

export function Terminal() {
  const lines = useStore((s) => s.terminalLines);
  const bodyRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // ★ BUG 修复：之前每次新行都 scrollIntoView({behavior:"smooth"})，用户向上滚阅读历史时
  //   会被拽回底部，且 smooth 动画在快速输出时叠加卡顿。
  //   修复：用容器级 scrollTop，只在用户已在底部附近时才自动滚。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    if (nearBottom) {
      body.scrollTop = body.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="terminal">
      <div className="panel-title">终端</div>
      <div className="terminal-body" ref={bodyRef}>
        {lines.length === 0 && <div className="empty">Agent 执行的命令会显示在这里</div>}
        {lines.map((l, i) => (
          <div key={i} className={`term-line ${l.kind}`}>
            {l.kind === "cmd" && <span className="prompt">$ </span>}
            <span className="text">{l.text}</span>
            {l.kind === "exit" && l.text !== "exit 0" && <span className="exit-warn"> ⚠</span>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
