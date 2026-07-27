#!/usr/bin/env node
// Regression test for client/model identity capture:
//  - clientInfo from the initialize request is logged on the request entry
//  - model from a sampling/createMessage response is logged on that response entry
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");
const mock = path.join(here, "mock-server-sampling.js");

const name = "modelstest-" + Date.now();
const proxy = spawn("node", [entry, "--", "node", mock], {
  env: { ...process.env, MCPTAP_NAME: name },
});

const fail = (msg) => { console.error("FAIL:", msg); proxy.kill(); process.exit(1); };

let out = "";
let repliedToSampling = false;
proxy.stdout.on("data", (c) => {
  out += c.toString();
  if (repliedToSampling) return;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id === "sample-1" && msg.method === "sampling/createMessage") {
      repliedToSampling = true;
      proxy.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: "sample-1",
        result: { model: "claude-test-model", role: "assistant", content: { type: "text", text: "hi" } },
      }) + "\n");
      break;
    }
  }
});

const send = (m) => proxy.stdin.write(JSON.stringify(m) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "test-client", version: "1.2.3" } } });

setTimeout(() => {
  proxy.stdin.end();
  proxy.kill();

  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(os.homedir(), ".mcptap", "logs", `${name}-${date}.jsonl`);
  if (!fs.existsSync(logFile)) fail(`log file not created: ${logFile}`);
  const raw = fs.readFileSync(logFile, "utf8");
  const entries = raw.trim().split("\n").map((l) => JSON.parse(l));

  const initReq = entries.find((e) => e.kind === "request" && e.method === "initialize");
  if (!initReq) fail("initialize request not logged");
  if (initReq.clientInfo?.name !== "test-client" || initReq.clientInfo?.version !== "1.2.3")
    fail(`clientInfo not captured correctly: ${JSON.stringify(initReq.clientInfo)}`);

  const sampleResp = entries.find((e) => e.kind === "response" && e.id === "sample-1");
  if (!sampleResp) fail("sampling/createMessage response not logged");
  if (sampleResp.model !== "claude-test-model") fail(`model not captured: ${JSON.stringify(sampleResp.model)}`);

  fs.unlinkSync(logFile); // clean up
  console.log("PASS: clientInfo and sampling model captured correctly in logs");
  process.exit(0);
}, 900);
