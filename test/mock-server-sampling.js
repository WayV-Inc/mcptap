#!/usr/bin/env node
// Fake MCP server used to test model capture via MCP sampling: after replying
// to initialize, pushes an unprompted sampling/createMessage request to the
// client and expects a response carrying `result.model`.
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === undefined) continue; // response to our own request (sampling) — not ours to reply to
    if (msg.id === undefined) continue; // notification, no reply
    const reply = { jsonrpc: "2.0", id: msg.id };
    if (msg.method === "initialize") {
      reply.result = { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mock", version: "0.0.1" } };
      process.stdout.write(JSON.stringify(reply) + "\n");
      process.stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: "sample-1", method: "sampling/createMessage",
        params: { messages: [{ role: "user", content: { type: "text", text: "hi" } }], maxTokens: 8 },
      }) + "\n");
      continue;
    } else if (msg.method === "tools/call") {
      reply.result = { content: [{ type: "text", text: "ok from mock" }] };
    } else {
      reply.error = { code: -32601, message: "Method not found" };
    }
    process.stdout.write(JSON.stringify(reply) + "\n");
  }
});
