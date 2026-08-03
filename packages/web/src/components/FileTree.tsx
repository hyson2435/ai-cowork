import { useEffect, useState } from "react";
import { useStore } from "../store";
import { sendAsync, genId } from "../ws";
import type { FileEntry } from "@ai-cowork/shared";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
}

/**
 * ★ B17 二进制文件扩展名判断：图片/字体/音视频/压缩包/PDF/Office 等。
 * 命中则不送 Monaco（避免乱码），仅展示提示。
 */
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tiff", ".svgz",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".webm", ".ogg", ".flac", ".m4a",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf",
  ".zip", ".gz", ".tar", ".tgz", ".rar", ".7z", ".bz2",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar",
  ".wasm", ".pak",
]);
function isBinaryFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTS.has(path.slice(dot).toLowerCase());
}

/** 把扁平 FileEntry[] 构建成嵌套树 */
function buildTree(entries: FileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();
  for (const e of entries) {
    const parts = e.path.split("/");
    const name = parts[parts.length - 1];
    const node: TreeNode = { name, path: e.path, type: e.type, children: e.type === "dir" ? [] : undefined };
    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      let parent = dirMap.get(parentPath);
      if (!parent) {
        // 父目录可能不在 entries 里（理论上 walk 会加），兜底建
        parent = { name: parts[parts.length - 2], path: parentPath, type: "dir", children: [] };
        dirMap.set(parentPath, parent);
        root.push(parent);
      }
      parent.children!.push(node);
    }
    if (e.type === "dir") dirMap.set(e.path, node);
  }
  // 排序：目录在前，然后按名字
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => n.children && sortRec(n.children));
  };
  sortRec(root);
  return root;
}

export function FileTree() {
  const files = useStore((s) => s.files);
  const currentPath = useStore((s) => s.currentPath);
  const lastChangedPath = useStore((s) => s.lastChangedPath);
  const sessionId = useStore((s) => s.sessionId);
  const setCurrentPath = useStore((s) => s.setCurrentPath);
  const setFileContent = useStore((s) => s.setFileContent);
  const [tree, setTree] = useState<TreeNode[]>([]);

  useEffect(() => {
    setTree(buildTree(files));
  }, [files]);

  const openFile = async (path: string) => {
    if (!sessionId) return;
    // ★ B17 二进制文件检测：图片/PDF/字体/音视频/zip 等不送 Monaco，直接提示
    if (isBinaryFile(path)) {
      setCurrentPath(path);
      setFileContent(path, `（二进制文件，无法以文本展示：${path}）`);
      return;
    }
    setCurrentPath(path);
    try {
      const data = (await sendAsync({ id: genId(), type: "file.read", sessionId, path })) as { content: string };
      // 后端按 utf-8 读，若内容含大量 U+FFFD 替换符 → 大概率是二进制被强转，提示一下
      const content = data.content ?? "";
      if (content.length > 0 && (content.match(/\uFFFD/g)?.length ?? 0) > content.length * 0.05) {
        setFileContent(path, `（检测到大量解码替换符，可能是二进制文件：${path}）\n\n${content.slice(0, 2000)}`);
      } else {
        setFileContent(path, content);
      }
    } catch (e) {
      // 读失败（可能是权限或不存在），忽略
      console.warn("file.read failed", e);
    }
  };

  if (files.length === 0) {
    return <div className="file-tree empty">暂无文件</div>;
  }

  return (
    <div className="file-tree">
      <div className="panel-title">文件</div>
      <div className="tree">
        {tree.map((n) => (
          <TreeItem key={n.path} node={n} depth={0} currentPath={currentPath} lastChangedPath={lastChangedPath} onOpen={openFile} />
        ))}
      </div>
    </div>
  );
}

function TreeItem({
  node,
  depth,
  currentPath,
  lastChangedPath,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  currentPath: string | null;
  lastChangedPath: string | null;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isCurrent = currentPath === node.path;
  const isChanged = lastChangedPath === node.path;

  if (node.type === "dir") {
    return (
      <div>
        <div
          className="tree-row dir"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="arrow">{expanded ? "▾" : "▸"}</span>
          <span className="icon">📁</span>
          <span>{node.name}</span>
        </div>
        {expanded && node.children?.map((c) => (
          <TreeItem
            key={c.path}
            node={c}
            depth={depth + 1}
            currentPath={currentPath}
            lastChangedPath={lastChangedPath}
            onOpen={onOpen}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`tree-row file ${isCurrent ? "current" : ""} ${isChanged ? "changed" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 + 16 }}
      onClick={() => onOpen(node.path)}
    >
      <span className="icon">📄</span>
      <span>{node.name}</span>
      {isChanged && <span className="changed-dot" title="最近变更">●</span>}
    </div>
  );
}
