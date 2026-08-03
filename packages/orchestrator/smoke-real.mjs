// M0 真实 Agent 烟囱测试：启动 session，监听事件流 30 秒，打印所有事件
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3001/ws");
let started = false;
let eventCount = 0;

ws.on("open", () => {
  console.log("[client] connected, sending session.start");
  ws.send(JSON.stringify({
    id: "c1",
    type: "session.start",
    cwd: "/tmp/aicowork-real",
    prompt: "在当前目录创建一个 hello.txt 文件，内容是 hello world",
    model: "deepseek/deepseek-chat",
  }));
  started = true;
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  eventCount++;

  // 响应类压缩打印
  if (msg.type === "response") {
    console.log(`[#${eventCount}] RESP ${msg.command} success=${msg.success}`, msg.error ? `err=${msg.error.slice(0,100)}` : "");
    return;
  }

  // 事件类按类型打印
  switch (msg.type) {
    case "session.ready":
      console.log(`[#${eventCount}] session.ready model=${msg.model}`);
      break;
    case "agent_start":
      console.log(`[#${eventCount}] === agent_start ===`);
      break;
    case "agent_end":
      console.log(`[#${eventCount}] === agent_end ===`);
      break;
    case "turn_start":
      console.log(`[#${eventCount}] --- turn_start ---`);
      break;
    case "turn_end":
      console.log(`[#${eventCount}] --- turn_end ---`);
      break;
    case "message_start":
      console.log(`[#${eventCount}] message_start role=${msg.role}`);
      break;
    case "message_end":
      console.log(`[#${eventCount}] message_end`);
      break;
    case "thinking_delta":
      process.stdout.write(msg.delta);
      break;
    case "text_delta":
      process.stdout.write(msg.delta);
      break;
    case "tool_start":
      console.log(`\n[#${eventCount}] 🔧 tool_start ${msg.toolName} ${JSON.stringify(msg.args).slice(0,120)}`);
      break;
    case "tool_end":
      console.log(`[#${eventCount}] ↳ tool_end ${msg.toolName} ${msg.isError ? "❌" : "✅"}`);
      break;
    case "queue_update":
      console.log(`[#${eventCount}] queue steer=${msg.steering.length} followUp=${msg.followUp.length}`);
      break;
    case "error":
      console.log(`[#${eventCount}] ⚠ ERROR ${msg.code}: ${msg.message.slice(0,200)}`);
      break;
    default:
      console.log(`[#${eventCount}] ${JSON.stringify(msg).slice(0,120)}`);
  }
});

ws.on("error", (e) => {
  console.error("[client] ws error", e.message);
  process.exit(1);
});

// 30 秒后退出
setTimeout(() => {
  console.log(`\n\n=== 共收到 ${eventCount} 条消息，测试结束 ===`);
  ws.close();
  process.exit(0);
}, 30000);
