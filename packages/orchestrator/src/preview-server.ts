/**
 * 静态预览服务器管理器：给每个 session 的 cwd 启动一个轻量 HTTP 静态服务器。
 * 前端通过 orchestrator 的 `/preview/:sessionId/...` 代理访问（见 server.ts 的 fastify 路由），
 * 这样不需要前端直连额外端口，部署/预览代理下也能用。
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize, sep, posix } from "node:path";

interface PreviewEntry {
  server: Server;
  port: number;
  cwd: string;
  entry?: string;
}

const entries = new Map<string, PreviewEntry>();
let nextPort = 4173; // Vite preview 默认端口之后开始

function pickPort(): number {
  return nextPort++;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function contentTypeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 做路径安全检查 + 转成绝对路径。
 * 任何跳出 cwd 的尝试返回 null。
 */
function safeResolve(cwd: string, urlPath: string): string | null {
  // decode 防止 %2e%2e 之类
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  // posix normalize，去掉开头的 /
  let rel = posix.normalize(decoded.replace(/^\/+/, ""));
  // 安全 1：规范化后开头仍为 .. 或含 \0 绝对不安全
  if (rel.startsWith("..") || rel.includes("\0")) return null;
  // 安全 2：Windows 下.. 可能写成 \..\ 形式，以及连续 /
  rel = rel.split(/[\\\/]+/).join("/");
  if (rel.startsWith("..")) return null;
  const cwdNorm = normalize(cwd.endsWith(sep) ? cwd.slice(0, -1) : cwd);
  const abs = normalize(join(cwdNorm, ...rel.split("/")));
  // 安全 3：abs 必须 === cwd 或在 cwd/ 之内
  if (abs !== cwdNorm && !abs.startsWith(cwdNorm + sep)) return null;
  return abs;
}

function makeStaticHandler(cwd: string, entry?: string) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      let urlPath = req.url ?? "/";
      // 根路径用 entry
      if (urlPath === "/" || urlPath === "") {
        if (entry) {
          urlPath = "/" + entry.replace(/^\/+/, "");
        } else {
          urlPath = "/index.html";
        }
      }
      const abs = safeResolve(cwd, urlPath);
      if (!abs) {
        res.writeHead(400);
        res.end("bad path");
        return;
      }
      // 路径可能是目录 -> 尝试 /index.html
      let file = abs;
      try {
        const st = await stat(file);
        if (st.isDirectory()) {
          file = join(file, "index.html");
        }
      } catch {
        // 找不到继续，readFile 会 404
      }
      if (!existsSync(file)) {
        // SPA 兜底：如果 entry 是 .html 文件，404 时退到 entry
        if (entry) {
          const fallback = safeResolve(cwd, "/" + entry.replace(/^\/+/, ""));
          if (fallback && existsSync(fallback)) {
            const buf = await readFile(fallback);
            res.writeHead(200, { "Content-Type": contentTypeOf(fallback) });
            res.end(buf);
            return;
          }
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found: " + urlPath);
        return;
      }
      const buf = await readFile(file);
      res.writeHead(200, {
        "Content-Type": contentTypeOf(file),
        "Cache-Control": "no-store",
      });
      res.end(buf);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("500 " + (e instanceof Error ? e.message : String(e)));
    }
  };
}

/** 启动预览服务器。返回内网 url（http://127.0.0.1:<port>）供 fastify 代理转发用。 */
export async function startPreview(
  sessionId: string,
  cwd: string,
  entry?: string,
): Promise<{ port: number; url: string; entry?: string; running: true }> {
  // 如果已经启动过，先停
  await stopPreview(sessionId);

  return new Promise((resolve, reject) => {
    const port = pickPort();
    const handler = makeStaticHandler(cwd, entry);
    const server = createServer((req, res) => void handler(req, res));
    const onError = (err: Error) => {
      server.close();
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      entries.set(sessionId, { server, port, cwd, entry });
      resolve({ port, url: `http://127.0.0.1:${port}`, entry, running: true });
    });
  });
}

export async function stopPreview(sessionId: string): Promise<void> {
  const e = entries.get(sessionId);
  if (!e) return;
  entries.delete(sessionId);
  await new Promise<void>((resolve) => {
    try {
      e.server.closeAllConnections?.();
    } catch {
      // 忽略
    }
    e.server.close(() => resolve());
  });
}

export function getPreview(sessionId: string) {
  return entries.get(sessionId);
}

/** 停止所有（进程退出时用） */
export function stopAllPreviews(): void {
  for (const id of [...entries.keys()]) {
    stopPreview(id).catch(() => {});
  }
}
