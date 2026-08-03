// M2: abort 立即停止验证
// 预期：Agent 收到 abort 后立即结束当前 turn，不再执行计划中的后续 tool calls
import WebSocket from "ws";

console.log("===== TEST: abort 立即停止 =====");
const ws = new WebSocket("ws://localhost:3001/ws");

let sid = "";
let turnCount = 0;
let toolCount = 0;
let aborted = false;
let errorAtTurn = -1;

ws.on("open", () => {
  ws.send(JSON.stringify({
    id: "c1", type: "session.start",
    cwd: "/tmp/aicowork-abort",
    // 刻意做一个 4 步连续写文件任务，Agent 会在一个 turn 里发 4 个 write tool calls
    prompt: "依次创建 4 个文件：w1.txt 写 'one'，w2.txt 写 'two'，w3.txt 写 'three'，w4.txt 写 'four'，每个文件写完再写一个",
    model: "deepseek/deepseek-chat",
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.type) {
    case "session.ready":
      sid = msg.sessionId;
      break;
    case "turn_start":
      turnCount++;
      console.log(`  turn #${turnCount} START`);
      break;
    case "turn_end":
      console.log(`  turn #${turnCount} END${aborted ? "（abort 后）" : ""}`);
      break;
    case "tool_start":
      toolCount++;
      console.log(`  🔧 T${toolCount}: ${msg.toolName} ${JSON.stringify(msg.args?.path ?? msg.args)}`);
      // 第 2 个 tool 开始后立刻 abort
      if (!aborted && toolCount === 2) {
        aborted = true;
        errorAtTurn = turnCount;
        setTimeout(() => {
          console.log(">>> ABORT 注入！");
          ws.send(JSON.stringify({ id: "x", type: "abort", sessionId: sid }));
        }, 100);
      }
      break;
    case "tool_end":
      console.log(`  ↳ T${toolCount} end ${msg.isError ? "❌" : "✅"}`);
      break;
    case "response":
      if (msg.command === "abort") console.log(`  RESP abort ${msg.success ? "ok" : "FAIL " + msg.error}`);
      break;
    case "error":
      console.log(`  ⚠ ${msg.code}: ${msg.message.slice(0,80)}`);
      break;
    case "agent_end": {
      setTimeout(() => {
        import("fs").then(fs => {
          const files = ["w1.txt","w2.txt","w3.txt","w4.txt"];
          const created = [];
          for (const f of files) {
            try {
              fs.readFileSync(`/tmp/aicowork-abort/${f}`, "utf-8");
              created.push(f);
            } catch {}
          }
          console.log(`  最终创建了 ${created.length}/4 个文件: ${created.join(", ")}`);
          console.log(`  共执行 ${toolCount} 次 tool calls`);
          // abort 成功标准：最多完成 2-3 个文件，不是 4 个
          const pass = created.length < 4 && toolCount < 4;
          console.log(pass
            ? "✅ PASS: abort 生效，第 4 个文件未创建"
            : `❌ FAIL: 应创建 <4 个文件，实际 ${created.length} 个 / toolCount=${toolCount}`);
          ws.close();
          process.exit(pass ? 0 : 1);
        });
      }, 500);
      break;
    }
    case "file.changed":
      // 静音
      break;
    case "text_delta":
      // 静音
      break;
    case "queue_update":
      break;
  }
});

ws.on("error", e => { console.error("ws error:", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT"); ws.close(); process.exit(1); }, 60000);
