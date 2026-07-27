#!/usr/bin/env node
// Minimal fake MCP server: replies to initialize and tools/call over stdio.
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
    if (msg.id === undefined) continue; // notification, no reply
    const reply = { jsonrpc: "2.0", id: msg.id };
    if (msg.method === "initialize") {
      reply.result = { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "mock", version: "0.0.1" } };
    } else if (msg.method === "tools/call") {
      reply.result = { content: [{ type: "text", text: "ok from mock" }] };
    } else {
      reply.error = { code: -32601, message: "Method not found" };
    }
    process.stdout.write(JSON.stringify(reply) + "\n");
  }
});
