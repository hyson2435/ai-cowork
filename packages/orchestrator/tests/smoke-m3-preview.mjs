// M3-1: preview-server 功能验证（不启 orchestrator，直调 dist/preview-server.js + 原生 http 测代理目标）
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__dirname, ".."));

const PV = await import("../dist/preview-server.js");

const CWD = "/tmp/aicowork-preview-test";
const SID = "test-session-id";

function assert(cond, msg) {
  if (!cond) {
    console.error("❌ FAIL:", msg);
    process.exit(1);
  }
  console.log("  ✅", msg);
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
          type: res.headers["content-type"],
        });
      });
    });
    req.on("error", reject);
  });
}

async function reset() {
  await rm(CWD, { recursive: true, force: true });
  await mkdir(CWD, { recursive: true });
  await mkdir(join(CWD, "dist"), { recursive: true });
  await mkdir(join(CWD, "sub"), { recursive: true });
}

console.log("===== TEST: 预览服务器 =====");
await reset();

// 构造文件
await writeFile(join(CWD, "index.html"), "<h1>Hello index</h1>", "utf-8");
await writeFile(join(CWD, "style.css"), "body{color:red}", "utf-8");
await writeFile(join(CWD, "dist/index.html"), "<h1>dist version</h1>", "utf-8");
await writeFile(join(CWD, "sub/page.html"), "<p>sub page</p>", "utf-8");
await writeFile(join(CWD, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47])); // 假装是 png

// ===== 1. 启动预览 =====
console.log("\n1. 启动 preview");
const info = await PV.startPreview(SID, CWD);
assert(typeof info.port === "number" && info.port > 0, `startPreview 返回 port=${info.port}`);
assert(info.running === true, "running = true");

// ===== 2. 根路径返回 index.html =====
console.log("\n2. GET / (入口未指定，退回 index.html)");
{
  const r = await httpGet(`http://127.0.0.1:${info.port}/`);
  assert(r.status === 200, `HTTP 200 (got ${r.status})`);
  assert(r.body === "<h1>Hello index</h1>", "body = index.html 内容");
  assert((r.type || "").startsWith("text/html"), `Content-Type=text/html (${r.type})`);
}

// ===== 3. 指定入口文件 =====
console.log("\n3. 指定入口 = dist/index.html");
const info2 = await PV.startPreview(SID, CWD, "dist/index.html");
{
  const r = await httpGet(`http://127.0.0.1:${info2.port}/`);
  assert(r.status === 200, `HTTP 200 (got ${r.status})`);
  assert(r.body === "<h1>dist version</h1>", "入口指定后，根路径返回 dist/index.html");
}

// ===== 4. 直链访问其他路径 =====
console.log("\n4. 直链 /style.css、/sub/page.html");
{
  const css = await httpGet(`http://127.0.0.1:${info2.port}/style.css`);
  assert(css.status === 200 && css.body === "body{color:red}", "style.css 内容正确");
  assert((css.type || "").startsWith("text/css"), `css Content-Type (${css.type})`);

  const sub = await httpGet(`http://127.0.0.1:${info2.port}/sub/page.html`);
  assert(sub.status === 200 && sub.body === "<p>sub page</p>", "sub/page.html 内容正确");
}

// ===== 5. 路径穿越尝试（启动一个 无 entry 的 session 做严格测试，避免 SPA fallback 混淆）=====
console.log("\n5. 路径穿越防护：无 entry 时 404/400，真实跳出 cwd 要被拒");
const safeSid = SID + "-safe";
const safeInfo = await PV.startPreview(safeSid, CWD); // 无 entry
const cases = [
  // 这些经 safeResolve 会判定在 cwd 下，但文件不存在 → 404（也算被正确拒绝）
  { path: "/../preview-server.ts", expect: [404, 400], note: "相对上级（cwd内但不存在）" },
  // 这些是真实跳出 cwd 的攻击：safeResolve 直接 null → 400
  { path: "/%2e%2e/etc/passwd", expect: [400, 404], note: "编码跳上级（实际跳出）" },
  { path: "/sub/../../etc/passwd", expect: [400, 404], note: "深路径跳上级（跳出）" },
];
for (const c of cases) {
  const r = await httpGet(`http://127.0.0.1:${safeInfo.port}${c.path}`);
  const ok = c.expect.includes(r.status);
  if (!ok) {
    console.error(`    ${c.note}: status=${r.status}`);
  }
  assert(ok, `${c.note}: ${c.path} 被拒绝 (status=${r.status})`);
}
await PV.stopPreview(safeSid);

// ===== 6. 404 + SPA fallback =====
console.log("\n6. 404 未知路径 + SPA fallback（入口存在时回退）");
{
  const nope = await httpGet(`http://127.0.0.1:${info2.port}/not-exist/123`);
  assert(nope.status === 200, `SPA fallback 回退到 dist/index.html（HTTP 200，实际${nope.status}）`);
  assert(nope.body === "<h1>dist version</h1>", "fallback 内容 = dist/index.html");
}
// 无 entry 的情况 -> 真 404
const info3 = await PV.startPreview(SID + "2", CWD); // 不传 entry
{
  const nope = await httpGet(`http://127.0.0.1:${info3.port}/definitely-not-exist`);
  assert(nope.status === 404, `无 entry 指定时未知路径返回 404（实际${nope.status}）`);
}
await PV.stopPreview(SID + "2");

// ===== 7. stopPreview =====
console.log("\n7. stopPreview 后服务器关闭");
await PV.stopPreview(SID);
await new Promise((r) => setTimeout(r, 100));
let threw = false;
try {
  await httpGet(`http://127.0.0.1:${info.port}/`);
} catch {
  threw = true;
}
assert(threw, "stop 后请求抛错（服务停了）");

// ===== 8. stopAllPreviews 清理 =====
console.log("\n8. stopAllPreviews 清理（多 session 场景）");
const a = await PV.startPreview("sA", CWD);
const b = await PV.startPreview("sB", CWD);
PV.stopAllPreviews();
await new Promise((r) => setTimeout(r, 150));
let ok = true;
for (const p of [a.port, b.port]) {
  try {
    await httpGet(`http://127.0.0.1:${p}/`);
    ok = false;
  } catch { /* 预期 */ }
}
assert(ok, "stopAllPreviews 后所有 session 预览都关闭");

console.log("\n🎉 ALL PASS");
await rm(CWD, { recursive: true, force: true });
