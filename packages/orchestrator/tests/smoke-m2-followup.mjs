// M2: follow_up 排队消费验证
// 预期：Agent 先完整执行原任务（a.txt + b.txt + 总结），原 turn 全部结束后才在新 turn 消费 follow_up（c.txt）
import WebSocket from "ws";

console.log("===== TEST: follow_up 排队消费 =====");
const ws = new WebSocket("ws://localhost:3001/ws");

let sid = "";
let turnCount = 0;
let toolCount = 0;
let injected = false;
let consumedTurn = -1;
let queueLog = [];

ws.on("open", () => {
  ws.send(JSON.stringify({
    id: "c1", type: "session.start",
    cwd: "/tmp/aicowork-followup",
    prompt: "先创建 a.txt 写 'apple'，再创建 b.txt 写 'banana'",
    model: "deepseek/deepseek-chat",
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  switch (msg.type) {
    case "response":
      console.log(`  RESP ${msg.command} ${msg.success ? "ok" : "FAIL"}`);
      break;
    case "session.ready":
      sid = msg.sessionId;
      console.log(`  session ${sid.slice(0,8)} ready`);
      break;
    case "turn_start":
      turnCount++;
      console.log(`  turn #${turnCount} START`);
      break;
    case "turn_end":
      console.log(`  turn #${turnCount} END`);
      break;
    case "tool_start":
      toolCount++;
      console.log(`  🔧 T${toolCount} start ${msg.toolName}`);
      // 在第 1 个 tool 后（Agent 还在忙）注入 follow_up
      if (!injected && toolCount === 1) {
        injected = true;
        setTimeout(() => {
          console.log(">>> INJECT follow_up: 再创建 c.txt 写 'cherry'");
          ws.send(JSON.stringify({
            id: "c2", type: "follow_up",
            sessionId: sid,
            message: "再创建 c.txt 写 'cherry'",
          }));
        }, 200); // 稍等，确保第 1 个 tool 已开始进入第 2 个
      }
      break;
    case "tool_end":
      console.log(`  ↳ T${toolCount} end ${msg.toolName} ${msg.isError ? "❌" : "✅"}`);
      break;
    case "queue_update":
      const qs = `steer=${msg.steering.length} followUp=${msg.followUp.length}`;
      queueLog.push(qs);
      console.log(`  queue: ${qs}`);
      break;
    case "file.changed":
      console.log(`  📁 ${msg.path}`);
      if (msg.path === "c.txt") {
        consumedTurn = turnCount;
      }
      break;
    case "text_delta":
      // 静音
      break;
    case "agent_end": {
      console.log(`  agent_end. total turns=${turnCount}`);
      const pass = consumedTurn >= 2; // 应在 turn 2+
      console.log(`  c.txt 消费 turn: ${consumedTurn}`);
      console.log(pass ? "✅ PASS: follow_up 在原 turn 之后消费（不打断）"
                       : `❌ FAIL: follow_up 应在 turn 2+ 消费，实际 ${consumedTurn}`);
      // 验证磁盘
      import("fs").then(fs => {
        try {
          const a = fs.readFileSync("/tmp/aicowork-followup/a.txt", "utf-8");
          const b = fs.readFileSync("/tmp/aicowork-followup/b.txt", "utf-8");
          const c = fs.readFileSync("/tmp/aicowork-followup/c.txt", "utf-8");
          console.log(`  文件验证: a="${a.trim()}", b="${b.trim()}", c="${c.trim()}"`);
        } catch (e) { console.log("  文件验证失败:", e.message); }
        ws.close();
        process.exit(pass ? 0 : 1);
      });
      break;
    }
    case "error":
      console.log(`  ⚠ ${msg.code}: ${msg.message}`);
      break;
  }
});

ws.on("error", e => { console.error("ws error:", e.message); process.exit(1); });
setTimeout(() => { console.log("TIMEOUT"); ws.close(); process.exit(1); }, 60000);
