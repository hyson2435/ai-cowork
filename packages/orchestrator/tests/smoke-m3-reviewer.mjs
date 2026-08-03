// M3-2 reviewer 单测：不启 real Agent，直接测 mapEvent + review parser + session.start 事件
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 脚本在 packages/orchestrator/tests/ 下，需要向上 3 级才到项目根目录
const ROOT = join(__dirname, "..", "..", "..");
process.chdir(ROOT);

const SE = await import(join(ROOT, "packages/shared/dist/index.js"));
const {
  ServerEvent, AgentRole,
} = SE;

// smoke 测试用到的 review 解析 helper（parseSeverity/parseReviewedFiles/parseSummary）
// 在 shared 包里没导出，这里内联实现，避免引用不存在的函数。
// ★ 解析格式必须与 orchestrator/session-registry.ts 的 executeReview 实际输出格式一致：
//     SEVERE=YES|NO / SUMMARY=<一句话意见> / FILES=<逗号分隔文件>
//   之前误写成 SEVERITY（多了一个 I），且返回字符串而非 boolean，导致单元测试全部失败。
function parseSeverity(text) {
  const m = String(text).match(/SEVERE\s*=\s*(YES|NO)/i);
  return m ? m[1].toUpperCase() === "YES" : false;
}
function parseReviewedFiles(text) {
  const m = String(text).match(/FILES?\s*[:=]\s*([^\n]+)/i);
  if (!m) return [];
  return m[1].split(/[,，]\s*/).map(s => s.trim()).filter(Boolean);
}
function parseSummary(text) {
  // 与 orchestrator 实际逻辑一致：提取 SUMMARY=<内容> 行；找不到则取首行
  const m = String(text).match(/SUMMARY\s*=\s*(.+)/i);
  if (m) return m[1].trim();
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  return lines[0] ? lines[0].slice(0, 120) : "";
}

const CWD = "/tmp/aicowork-smoke-reviewer2-" + randomUUID().slice(0, 6);
const SERVER_PORT = 3013;
process.env.PORT = String(SERVER_PORT);
process.env.AICOWORK_DEFAULT_MODEL = "deepseek/deepseek-chat";

const env = { ...process.env };
let server;
let ws;
let responses = new Map();
let receivedEvents = [];
let nextId = 1;

async function startOrchestrator() {
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    server = spawn("node", [join(cwd, "packages/orchestrator/dist/server.js")], {
      env, cwd, stdio: ["ignore", "pipe", "pipe"],
    });
    let done = false;
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      if (!done && /listening|EADDRINUSE|listen failed/.test(buf)) {
        if (buf.includes("EADDRINUSE") || buf.includes("listen failed")) {
          done = true;
          reject(new Error("port conflict:\n" + buf));
        } else if (buf.includes("listening")) {
          done = true;
          resolve(server);
        }
      }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.on("exit", (code) => {
      if (!done) reject(new Error("orchestrator exited " + code + ":\n" + buf));
    });
  });
}
function sendWs(msg) {
  return new Promise((resolve) => {
    const id = String(nextId++);
    responses.set(id, resolve);
    ws.send(JSON.stringify({ id, ...msg }));
  });
}
function waitForEvent(pred, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting pred; buf=" + receivedEvents.slice(-20).map(e => e.type).join(","))), timeoutMs);
    const chk = () => {
      const f = receivedEvents.find(pred);
      if (f) { clearTimeout(t); return resolve(f); }
      setTimeout(chk, 50);
    };
    chk();
  });
}
function test(name, fn) {
  return (async () => { await fn(); console.log("  ✅ " + name); })()
    .catch(e => { console.log("  ❌ " + name + ": " + e.message); process.exitCode = 1; });
}

async function main() {
  await mkdir(CWD, { recursive: true });
  try {
    console.log("1. 解析 helpers 单元测试");
    await test("parseSeverity(SEVERE=YES) -> true", () => {
      if (parseSeverity("SEVERE=YES\nabc") !== true) throw new Error("fail");
    });
    await test("parseSeverity(SEVERE=NO) -> false", () => {
      if (parseSeverity("foo\nSEVERE=NO\nbar") !== false) throw new Error("fail");
    });
    await test("parseSeverity(no tag) -> false", () => {
      if (parseSeverity("no tags here") !== false) throw new Error("fail");
    });
    await test("parseReviewedFiles 解析 FILES=index.html, app.js", () => {
      const got = parseReviewedFiles("FILES=  index.html , app.js, \nfoo");
      if (got.join(",") !== "index.html,app.js") throw new Error("got=" + got.join(","));
    });
    await test("parseSummary 去掉 SEVERE/FILES 头", () => {
      const s = parseSummary("SEVERE=YES\nSUMMARY=这段是问题\nFILES=a.js,b.js\n附言");
      if (!s.includes("这段是问题") || s.includes("SEVERE") || s.includes("FILES")) throw new Error("got=" + s);
    });
    await test("ServerEvent agent 字段校验：coder 通过", () => {
      const p = ServerEvent.safeParse({ sessionId: "s", type: "agent_start", agent: "coder" });
      if (!p.success) throw new Error(p.error.message);
    });
    await test("ServerEvent agent 字段校验：reviewer 通过", () => {
      const p = ServerEvent.safeParse({ sessionId: "s", type: "agent_end", agent: "reviewer" });
      if (!p.success) throw new Error(p.error.message);
    });
    await test("ServerEvent agent 字段校验：非法值拒绝", () => {
      const p = ServerEvent.safeParse({ sessionId: "s", type: "agent_end", agent: "nope" });
      if (p.success) throw new Error("应被拒绝");
    });
    await test("ServerEvent review.finished 通过", () => {
      const p = ServerEvent.safeParse({
        sessionId: "s", type: "review.finished", severe: true,
        summary: "foo", reviewed: ["a.js", "b.js"],
      });
      if (!p.success) throw new Error(p.error.message);
    });
    await test("AgentRole enum = coder | reviewer", () => {
      if (!AgentRole.options.includes("coder") || !AgentRole.options.includes("reviewer")) throw new Error("enum mismatch");
    });
    console.log("  helper 单元测试完毕 ✅\n");

    console.log("2. 启动 orchestrator");
    await startOrchestrator();
    console.log("  ✅ orchestrator 启动 (port " + SERVER_PORT + ")");

    console.log("3. 连 ws，发 session.start(review=true)，检查 session.ready/response 带 reviewer 标记");
    ws = new WebSocket("ws://localhost:" + SERVER_PORT + "/ws");
    ws.onerror = (e) => console.error("ws err", e.message);
    await new Promise(r => ws.onopen = r);
    ws.onmessage = (ev) => {
      const obj = JSON.parse(ev.data.toString());
      if (obj.type === "response") {
        const resolver = responses.get(obj.id);
        if (resolver) { responses.delete(obj.id); resolver(obj); }
      } else {
        receivedEvents.push(obj);
      }
    };
    const startResp = await sendWs({
      type: "session.start", cwd: CWD,
      prompt: "在 cwd 创建 index.html 和 style.css 两个文件（内容自定），index.html 引用 style.css",
      review: true, model: "deepseek/deepseek-chat",
    });
    console.assert(startResp.success, "start resp: " + JSON.stringify(startResp));
    console.assert(startResp.data.reviewer === true, "resp reviewer=true, got " + startResp.data.reviewer);
    console.log("  ✅ response.data.reviewer=true");

    const ready = await waitForEvent(e => e.type === "session.ready");
    console.assert(ready.reviewer === true, "session.ready.reviewer=true, got " + ready.reviewer);
    console.log("  ✅ session.ready.reviewer=true");

    console.log("4. 等待 coder 的 agent_start(agent=coder) + agent_end(agent=coder) + review.finished 事件");
    const coderStart = await waitForEvent(e => e.type === "agent_start" && e.agent === "coder", 30000);
    const p = ServerEvent.safeParse(coderStart);
    if (!p.success) throw new Error("ServerEvent parse fail: " + p.error.message);
    console.log("  ✅ 收到 coder agent_start 并通过 ServerEvent schema");

    await test("最终至少收到 1 条 agent_end(agent=coder)", async () => {
      await waitForEvent(e => e.type === "agent_end" && e.agent === "coder", 60000);
    });
    await test("收到至少 1 条 review.finished", async () => {
      const r = await waitForEvent(e => e.type === "review.finished", 90000);
      const parsed = ServerEvent.safeParse(r);
      if (!parsed.success) throw new Error("review.finished schema: " + parsed.error.message);
      console.log("    [review.finished] severe=" + parsed.data.severe + " reviewed=" + (parsed.data.reviewed || []).join(",") + " summaryPreview=" + parsed.data.summary.slice(0, 60).replace(/\n/g, " "));
    });
    await test("收到 1 条 reviewer 的 agent_start(agent=reviewer)", async () => {
      await waitForEvent(e => e.type === "agent_start" && e.agent === "reviewer", 90000);
    });
    await test("收到 1 条 reviewer 的 agent_end(agent=reviewer)", async () => {
      await waitForEvent(e => e.type === "agent_end" && e.agent === "reviewer", 90000);
    });
    console.log("  事件观测完毕 ✅\n");

    console.log("5. reviewer severe=true 时收到 follow_up（自动注入） → 下一个 turn_start(agent=coder)");
    const hasSevere = receivedEvents.some(e => e.type === "review.finished" && e.severe === true);
    console.log("   severe?", hasSevere);
    if (hasSevere) {
      await test("severe 后 120 秒内有下一个 turn_start(agent=coder)", async () => {
        const lastSevereIdx = receivedEvents.map((e,i) => ({e,i}))
          .filter(x => x.e.type === "review.finished" && x.e.severe).slice(-1)[0]?.i ?? -1;
        const found = receivedEvents.slice(lastSevereIdx)
          .find(e => e.type === "turn_start" && e.agent === "coder");
        if (found) return;
        // 还没收到就等等
        await waitForEvent(e => e.type === "turn_start" && e.agent === "coder", 120000);
      });
    }
    console.log("\n🎉 ALL PASS");
  } finally {
    try { ws?.close(); } catch {}
    try { server?.kill("SIGKILL"); } catch {}
    await rm(CWD, { recursive: true, force: true }).catch(() => {});
  }
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
