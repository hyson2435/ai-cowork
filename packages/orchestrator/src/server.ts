/**
 * Orchestrator 入口：Fastify + WebSocket。
 * - WS /ws：收 ClientCommand，调 SessionRegistry，回 CommandResponse；broadcast ServerEvent。
 * - GET /：健康检查。
 * - GET /preview/:sessionId/*：静态预览服务器的 HTTP 代理（指向 session 的 preview server），
 *   这样前端不需要直接访问额外端口，经预览代理时依然可用。
 */
import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import http from "node:http";
import { URL } from "node:url";
import type { WebSocket } from "ws";
import {
  ClientCommand,
  type CommandResponse,
  type ServerEvent,
} from "@ai-cowork/shared";
import { config } from "./config.js";
import { SessionRegistry } from "./session-registry.js";

const fastify = Fastify({ logger: { level: "info" } });
await fastify.register(fastifyWebsocket);

const clients = new Set<WebSocket>();

// preview.updated 的简单 debounce：sessionId -> timer，避免一次写入刷 10 次 iframe
const previewTimers = new Map<string, ReturnType<typeof setTimeout>>();

const broadcast = (event: ServerEvent) => {
  const msg = JSON.stringify(event);
  for (const c of clients) {
    try {
      c.send(msg);
    } catch {
      // 连接已断开，忽略
    }
  }
  // 如果是 file.changed 且该 session 有 preview 在跑，debounce 发 preview.updated
  if (event.type === "file.changed") {
    const port = registry.getPreviewPort(event.sessionId);
    if (port) {
      const old = previewTimers.get(event.sessionId);
      if (old) clearTimeout(old);
      previewTimers.set(
        event.sessionId,
        setTimeout(() => {
          previewTimers.delete(event.sessionId);
          const upd: ServerEvent = {
            sessionId: event.sessionId,
            type: "preview.updated",
            path: event.path,
          };
          const updMsg = JSON.stringify(upd);
          for (const c of clients) {
            try {
              c.send(updMsg);
            } catch {
              // 忽略
            }
          }
        }, 250),
      );
    }
  }
};

const registry = new SessionRegistry(broadcast);

fastify.get("/", async () => ({ ok: true, service: "ai-cowork-orchestrator", sessions: registry["sessions"]?.size ?? 0 }));

/**
 * 预览代理：/preview/:sessionId/rest/of/path -> http://127.0.0.1:<previewPort>/rest/of/path
 */
fastify.get(
  "/preview/:sessionId/*",
  async (req: FastifyRequest<{ Params: { sessionId: string; "*"?: string } }>, reply: FastifyReply) => {
    const sessionId = req.params.sessionId;
    const port = registry.getPreviewPort(sessionId);
    if (!port) {
      reply.code(404).send("preview not running for session");
      return;
    }
    const rest = req.params["*"] ?? "";
    const qs = (req.url as string).split("?")[1];
    const upstreamUrl = `http://127.0.0.1:${port}/${rest}${qs ? "?" + qs : ""}`;
    // 用 node http 反向代理，不加新依赖
    await new Promise<void>((resolve) => {
      const u = new URL(upstreamUrl);
      const opts: http.RequestOptions = {
        method: req.method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          // 透传浏览器的 accept/cookie 等，去掉 host（否则会指向外层 host）
          ...Object.fromEntries(
            Object.entries(req.headers).filter(([k]) => k.toLowerCase() !== "host"),
          ),
          host: u.host,
        },
      };
      const proxyReq = http.request(opts, (upRes) => {
        reply.code(upRes.statusCode ?? 200);
        // 去掉 transfer-encoding / content-length 等冲突头
        const skip = new Set(["transfer-encoding", "connection", "keep-alive"]);
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (skip.has(k.toLowerCase())) continue;
          if (v === undefined) continue;
          // fastify header 接受 string | string[]；upRes.headers 的值类型正确
          reply.header(k, v as never);
        }
        upRes.on("data", (chunk) => reply.raw.write(chunk));
        upRes.on("end", () => {
          reply.raw.end();
          resolve();
        });
      });
      proxyReq.on("error", (err) => {
        reply.code(502).send("preview upstream error: " + err.message);
        resolve();
      });
      proxyReq.end();
    });
  },
);

fastify.get("/ws", { websocket: true }, (socket: WebSocket) => {
  clients.add(socket);

  socket.on("message", async (raw: Buffer) => {
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      send(socket, { id: "", type: "response", command: "", success: false, error: "invalid JSON" });
      return;
    }

    const parsed = ClientCommand.safeParse(payload);
    if (!parsed.success) {
      send(socket, {
        id: (payload as { id?: string })?.id ?? "",
        type: "response",
        command: (payload as { type?: string })?.type ?? "",
        success: false,
        error: parsed.error.message,
      });
      return;
    }
    await handleCommand(parsed.data, (resp) => send(socket, resp));
  });

  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => clients.delete(socket));
});

function send(socket: WebSocket, msg: CommandResponse | ServerEvent) {
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    // 忽略
  }
}

async function handleCommand(cmd: ClientCommand, reply: (r: CommandResponse) => void) {
  try {
    switch (cmd.type) {
      case "session.start": {
        const { sessionId, model, reviewer, permissionMode } = await registry.start({
          cwd: cmd.cwd,
          prompt: cmd.prompt,
          model: cmd.model,
          review: (cmd as { review?: boolean }).review,
          permissionMode: (cmd as { permissionMode?: "free" | "read-only" | "plan" }).permissionMode,
        });
        const dataObj: { sessionId: string; model?: string; reviewer?: boolean; permissionMode: string } = { sessionId, model, reviewer, permissionMode };
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true, data: dataObj });
        broadcast({ sessionId, type: "session.ready", model, reviewer, permissionMode });
        break;
      }
      case "steer":
        await registry.steer(cmd.sessionId, cmd.message);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        break;
      case "follow_up":
        await registry.followUp(cmd.sessionId, cmd.message);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        break;
      case "abort":
        await registry.abort(cmd.sessionId);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        break;
      case "prompt":
        await registry.prompt(cmd.sessionId, cmd.message, cmd.streamingBehavior);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        break;
      case "file.list": {
        const entries = await registry.listFiles(cmd.sessionId);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true, data: entries });
        break;
      }
      case "file.read": {
        const content = await registry.readFile(cmd.sessionId, cmd.path);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true, data: { path: cmd.path, content } });
        break;
      }
      case "checkpoint.create": {
        const cp = await registry.createCheckpoint(cmd.sessionId, cmd.label);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true, data: cp });
        broadcast({ sessionId: cmd.sessionId, type: "checkpoint.created", checkpoint: cp });
        break;
      }
      case "checkpoint.list": {
        const list = await registry.listCheckpoints(cmd.sessionId);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true, data: list });
        break;
      }
      case "checkpoint.rollback": {
        await registry.rollbackCheckpoint(cmd.sessionId, cmd.checkpointId);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        broadcast({ sessionId: cmd.sessionId, type: "checkpoint.rolled_back", checkpointId: cmd.checkpointId });
        break;
      }
      case "preview.start": {
        const preview = await registry.startPreview(cmd.sessionId, cmd.entry);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true, data: preview });
        broadcast({ sessionId: cmd.sessionId, type: "preview.started", preview });
        break;
      }
      case "preview.stop": {
        await registry.stopPreview(cmd.sessionId);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        broadcast({ sessionId: cmd.sessionId, type: "preview.stopped" });
        break;
      }
      case "copilot.chat": {
        await registry.copilotChat(cmd.sessionId, cmd.message);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        break;
      }
      case "copilot.apply": {
        await registry.copilotApply(cmd.sessionId, cmd.instruction, cmd.mode);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        break;
      }
      case "plan.approve": {
        await registry.planApprove(cmd.sessionId, cmd.decision, cmd.feedback);
        reply({ id: cmd.id, type: "response", command: cmd.type, success: true });
        break;
      }
    }
  } catch (e) {
    reply({
      id: cmd.id,
      type: "response",
      command: cmd.type,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

// 优雅退出
const shutdown = (sig: string) => {
  fastify.log.info({ sig }, "shutting down");
  registry.disposeAll();
  fastify.close().then(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (!config.anthropicKey && !config.openaiKey && !config.deepseekKey) {
  fastify.log.warn("未检测到 ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY，Agent 可能无法运行");
}

fastify
  .listen({ port: config.port, host: "0.0.0.0" })
  .then(() => fastify.log.info(`orchestrator listening on :${config.port}`))
  .catch((err) => {
    fastify.log.error(err, "listen failed");
    process.exit(1);
  });
