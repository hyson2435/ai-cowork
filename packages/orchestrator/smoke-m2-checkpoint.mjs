// M2: checkpoint 创建/列出/回滚 功能验证（直接调 orchestrator/checkpoints.ts 模块，不启 WS）
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(join(__dirname, "..")); // 切到 orchestrator 目录以便 import .js dist（如果是 ts 用 tsx 跑的话其实 src 也可以）

// import 编译后的 dist（build 脚本已跑完）
const CP = await import("./dist/checkpoints.js");

const CWD = "/tmp/aicowork-checkpoint-test";
const dataDir = join(CWD, "data");

async function reset() {
  await rm(CWD, { recursive: true, force: true });
  await mkdir(CWD, { recursive: true });
  await mkdir(dataDir, { recursive: true });
}

function assert(cond, msg) {
  if (!cond) {
    console.error("❌ FAIL:", msg);
    process.exit(1);
  }
  console.log("  ✅", msg);
}

console.log("===== TEST: checkpoint 创建/列出/回滚 =====");

await reset();

// ===== 1. 初始状态 =====
console.log("\n1. 初始状态：写 v1 内容");
await writeFile(join(CWD, "a.txt"), "apple-v1", "utf-8");
await writeFile(join(CWD, "b.txt"), "banana-v1", "utf-8");
await writeFile(join(dataDir, "c.txt"), "cherry-v1", "utf-8");
const beforeCpList = await CP.listCheckpoints(CWD);
assert(beforeCpList.length === 0, "初始没有 checkpoint");

// ===== 2. 创建 v1 checkpoint =====
console.log("\n2. 创建 checkpoint v1");
const cp1 = await CP.createCheckpoint(CWD, "版本1：三个 txt 都是 v1");
assert(cp1.id && cp1.createdAt > 0, `createCheckpoint 返回 id=${cp1.id.slice(0,8)}`);
assert(cp1.label === "版本1：三个 txt 都是 v1", "label 被保存");
assert(cp1.fileCount === 3, `fileCount=3（实际${cp1.fileCount}）`);

const list1 = await CP.listCheckpoints(CWD);
assert(list1.length === 1, "list 有 1 个 checkpoint");
assert(list1[0].id === cp1.id, "list 中 id 匹配");
assert(list1[0].label === cp1.label, "list 中 label 匹配");

// ===== 3. 修改文件（v2） =====
console.log("\n3. 修改文件到 v2 + 新增 d.txt");
await writeFile(join(CWD, "a.txt"), "apple-v2", "utf-8");
await writeFile(join(CWD, "b.txt"), "banana-v2", "utf-8");
await writeFile(join(dataDir, "c.txt"), "cherry-v2", "utf-8");
await writeFile(join(CWD, "d.txt"), "date-v2", "utf-8");
// 读回来确认
assert((await readFile(join(CWD, "a.txt"), "utf-8")) === "apple-v2", "a.txt 已变 v2");
assert(existsSync(join(CWD, "d.txt")), "d.txt 已创建");

// 再创建一个 cp
const cp2 = await CP.createCheckpoint(CWD, "版本2：改了 abc + 新 d");
assert(cp2.fileCount === 4, `cp2 fileCount=4（实际${cp2.fileCount}）`);
const list2 = await CP.listCheckpoints(CWD);
assert(list2.length === 2, "现在有 2 个 checkpoint");
assert(list2[0].id === cp2.id, "按时间倒序，cp2 在前面");

// ===== 4. 回滚到 cp1 =====
console.log("\n4. 回滚到 cp1（应只看到 a/b/data/c 三个文件，内容 v1，d 消失）");
await CP.rollbackCheckpoint(CWD, cp1.id);

// 验证文件
assert(
  (await readFile(join(CWD, "a.txt"), "utf-8")) === "apple-v1",
  "回滚后 a.txt = v1"
);
assert(
  (await readFile(join(CWD, "b.txt"), "utf-8")) === "banana-v1",
  "回滚后 b.txt = v1"
);
assert(
  (await readFile(join(dataDir, "c.txt"), "utf-8")) === "cherry-v1",
  "回滚后 data/c.txt = v1（子目录文件也还原）"
);
assert(
  !existsSync(join(CWD, "d.txt")),
  "回滚后 d.txt 被删除（cp1 里没有它）"
);

// .aicowork 目录应该还在（因为 rollback 不删 .aicowork）
assert(existsSync(join(CWD, ".aicowork")), ".aicowork/checkpoints 未被删，保留历史快照");
const listAfterRollback = await CP.listCheckpoints(CWD);
assert(listAfterRollback.length === 2, "回滚后 cp 列表仍有 2 个（快照没被删）");

// ===== 5. 回滚到 cp2 再验证 =====
console.log("\n5. 再回滚到 cp2（确认 d.txt 和 v2 回来）");
await CP.rollbackCheckpoint(CWD, cp2.id);
assert(
  (await readFile(join(CWD, "a.txt"), "utf-8")) === "apple-v2",
  "再次回滚后 a.txt = v2"
);
assert(
  existsSync(join(CWD, "d.txt")),
  "再次回滚后 d.txt 回来了"
);

// ===== 6. 边界：回滚不存在的 checkpoint 应该报错 =====
console.log("\n6. 边界：回滚不存在的 id 应抛错");
let threw = false;
try {
  await CP.rollbackCheckpoint(CWD, "00000000-0000-0000-0000-000000000000");
} catch {
  threw = true;
}
assert(threw, "rollback 不存在的 id 会抛错（不会造成事故）");

console.log("\n🎉 ALL PASS");
await rm(CWD, { recursive: true, force: true });
