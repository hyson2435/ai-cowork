// M0 烟囱测试：连 WS，发一条 session.start（无 API key 会失败，但能验证协议链路）
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:3001/ws");
ws.on("open", () => {
  console.log("[client] connected");
  ws.send(JSON.stringify({ id: "c1", type: "session.start", cwd: "/tmp/aicowork-test", prompt: "hi" }));
});
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log("[client] <-", JSON.stringify(msg));
  if (msg.type === "response" && msg.id === "c1") {
    // 不管成功失败，协议通了就关
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 1000);
  }
});
ws.on("error", (e) => {
  console.error("[client] error", e.message);
  process.exit(1);
});
setTimeout(() => process.exit(2), 8000);
