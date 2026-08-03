import { useEffect, useRef } from "react";
import { useStore } from "../store";

export function Terminal() {
  const lines = useStore((s) => s.terminalLines);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="terminal">
      <div className="panel-title">终端</div>
      <div className="terminal-body">
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
