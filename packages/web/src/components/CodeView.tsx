import Editor from "@monaco-editor/react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

type EditorInstance = Parameters<NonNullable<Parameters<typeof Editor>[0]["onMount"]>>[0];
type MonacoInstance = Parameters<NonNullable<Parameters<typeof Editor>[0]["onMount"]>>[1];

export function CodeView() {
  const currentPath = useStore((s) => s.currentPath);
  const fileContents = useStore((s) => s.fileContents);
  const fileDiffLines = useStore((s) => s.fileDiffLines);
  const lastChangedPath = useStore((s) => s.lastChangedPath);
  const lastChangedToolCallId = useStore((s) => s.lastChangedToolCallId);
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const decorationsRef = useRef<string[]>([]);
  // ★ BUG 修复：editorRef/monacoRef 是 ref，赋值不触发 re-render，也不在 effect 依赖里。
  //   首次挂载时 effect 同步执行，editorRef.current 为 null 直接 return，diff 高亮丢失。
  //   Monaco 异步加载后 onMount 赋值 ref，但 content/diffLines/currentPath 未变，effect 不再运行。
  //   修复：引入 editorReady state，onMount 末尾 setEditorReady(true)，加入 effect 依赖。
  const [editorReady, setEditorReady] = useState(false);

  const content = currentPath ? fileContents[currentPath] ?? "" : "";
  const diffLines = currentPath ? fileDiffLines[currentPath] ?? [] : [];

  const language = currentPath ? getLanguage(currentPath) : "plaintext";
  const isJustChanged = currentPath === lastChangedPath && lastChangedToolCallId !== null;

  // 应用/刷新 diff 行高亮（Monaco decorations）
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const decos = diffLines.map((ln) => ({
      range: new monaco.Range(ln + 1, 1, ln + 1, 1),
      options: {
        isWholeLine: true,
        className: "diff-changed-line",
        linesDecorationsClassName: "diff-glyph",
      },
    }));
    // deltaDecorations 本身就是 diff 更新（旧→新），一次调用即可
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decos);
  }, [content, diffLines, currentPath, editorReady]);

  // 文件变更时：有 diff 行就跳到第一处变更，否则滚到顶部
  useEffect(() => {
    if (!editorRef.current || !currentPath) return;
    if (currentPath === lastChangedPath) {
      if (diffLines.length > 0) {
        editorRef.current.revealLineInCenter(diffLines[0] + 1);
      } else {
        editorRef.current.setScrollTop(0);
      }
    }
  }, [lastChangedPath, lastChangedToolCallId, currentPath, diffLines, editorReady]);

  if (!currentPath) {
    return (
      <div className="code-view empty">
        <div className="empty-hint">选择一个文件，或等 Agent 写代码时自动跳转</div>
      </div>
    );
  }

  return (
    <div className="code-view">
      <div className={`code-tab ${isJustChanged ? "just-changed" : ""}`}>
        <span className="file-icon">📄</span>
        <span className="file-path">{currentPath}</span>
        {isJustChanged && <span className="changed-badge">刚刚变更</span>}
        {diffLines.length > 0 && (
          <span className="diff-count">{diffLines.length} 行变更</span>
        )}
      </div>
      <div className="editor-wrap">
        <Editor
          height="100%"
          theme="vs-dark"
          language={language}
          value={content}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            setEditorReady(true);
          }}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", html: "html", css: "css", scss: "scss",
    py: "python", go: "go", rs: "rust", java: "java", sh: "shell",
    yml: "yaml", yaml: "yaml", xml: "xml", sql: "sql",
  };
  return map[ext ?? ""] ?? "plaintext";
}
