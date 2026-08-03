// M1 事件派生验证：让 Agent 写文件 + 跑命令，确认 file.changed 和 terminal.* 事件派生
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3001/ws");
let eventCount = 0;
let fileChanged = 0;
let terminalEvents = 0;

ws.on("open", () => {
  console.log("[client] connected, starting session");
  ws.send(JSON.stringify({
    id: "c1",
    type: "session.start",
    cwd: "/tmp/aicowork-m1",
    prompt: "创建文件 test.html 内容是 <h1>hello</h1>，然后运行命令 ls -la 列出当前目录",
    model: "deepseek/deepseek-chat",
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  eventCount++;

  if (msg.type === "response") {
    console.log(`[#${eventCount}] RESP ${msg.command} ${msg.success ? "ok" : "FAIL"}`);
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
    case "text_delta":
      process.stdout.write(msg.delta);
      break;
    case "tool_start":
      console.log(`\n[#${eventCount}] 🔧 tool_start ${msg.toolName} ${JSON.stringify(msg.args).slice(0,100)}`);
      break;
    case "tool_end":
      console.log(`[#${eventCount}] ↳ tool_end ${msg.toolName} ${msg.isError ? "❌" : "✅"}`);
      break;
    case "file.changed":
      fileChanged++;
      console.log(`[#${eventCount}] 📁 FILE.CHANGED path=${msg.path} kind=${msg.kind} contentLen=${msg.content?.length ?? 0}`);
      break;
    case "terminal.cmd":
      terminalEvents++;
      console.log(`[#${eventCount}] 💻 TERMINAL.CMD: ${msg.command}`);
      break;
    case "terminal.output":
      terminalEvents++;
      console.log(`[#${eventCount}] TERMINAL.OUTPUT [${msg.stream}]: ${msg.delta.slice(0,120)}`);
      break;
    case "terminal.exit":
      terminalEvents++;
      console.log(`[#${eventCount}] TERMINAL.EXIT code=${msg.exitCode}`);
      break;
    case "error":
      console.log(`[#${eventCount}] ⚠ ERROR ${msg.code}: ${msg.message.slice(0,150)}`);
      break;
  }
});

ws.on("error", (e) => {
  console.error("[client] ws error", e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log(`\n=== 共 ${eventCount} 条消息 | file.changed=${fileChanged} | terminal.*=${terminalEvents} ===`);
  ws.close();
  process.exit(0);
}, 45000);
