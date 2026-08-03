// M0 steer 验证：启动一个稍长任务，中途 steer 改要求，验证不 abort 且吸收新要求
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3001/ws");
let eventCount = 0;
let steered = false;
let toolCalls = 0;

ws.on("open", () => {
  console.log("[client] connected, starting session");
  ws.send(JSON.stringify({
    id: "c1",
    type: "session.start",
    cwd: "/tmp/aicowork-steer",
    prompt: "创建一个文件 greeting.txt，内容写 'Hello World'，然后再创建一个文件 info.txt，内容写 'This is a test file'",
    model: "deepseek/deepseek-chat",
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  eventCount++;

  if (msg.type === "response") {
    console.log(`[#${eventCount}] RESP ${msg.command} ${msg.success ? "ok" : "FAIL " + msg.error}`);
    return;
  }

  switch (msg.type) {
    case "session.ready":
      console.log(`[#${eventCount}] session.ready model=${msg.model}`);
      break;
    case "agent_start":
      console.log(`[#${eventCount}] === agent_start ===`);
      break;
    case "agent_end":
      console.log(`[#${eventCount}] === agent_end ===\n`);
      break;
    case "turn_start":
      console.log(`[#${eventCount}] --- turn_start ---`);
      break;
    case "turn_end":
      console.log(`[#${eventCount}] --- turn_end ---`);
      break;
    case "text_delta":
      process.stdout.write(msg.delta);
      break;
    case "tool_start":
      toolCalls++;
      console.log(`\n[#${eventCount}] 🔧 tool_start ${msg.toolName} ${JSON.stringify(msg.args).slice(0,150)}`);
      // 在第一个工具调用后注入 steer：把第二个文件内容改成中文
      if (!steered && toolCalls === 1) {
        steered = true;
        console.log(`\n>>> [STEER] 第一个工具刚调用，注入 steer: 把后续文件内容改成中文`);
        ws.send(JSON.stringify({
          id: "c2",
          type: "steer",
          sessionId: msg.sessionId,
          message: "等等！info.txt 的内容改成中文：'这是一个测试文件'",
        }));
      }
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
      // message_start/end 不打印，减少噪音
  }
});

ws.on("error", (e) => {
  console.error("[client] ws error", e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log(`\n=== 共 ${eventCount} 条消息，steer 注入 ${steered ? "已执行" : "未执行"} ===`);
  ws.close();
  process.exit(0);
}, 60000);
