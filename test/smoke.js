#!/usr/bin/env node
// Smoke test: run mcptap wrapping the mock server, send requests, verify
// passthrough responses AND that the audit log recorded the traffic.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");
const mock = path.join(here, "mock-server.js");

const name = "smoketest-" + Date.now();
const proxy = spawn("node", [entry, "--", "node", mock], {
  env: { ...process.env, MCPTAP_NAME: name },
});

let out = "";
proxy.stdout.on("data", (c) => (out += c.toString()));

const send = (m) => proxy.stdin.write(JSON.stringify(m) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", apiKey: "SHOULD-BE-REDACTED" } });
send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
send({ jsonrpc: "2.0", id: 3, method: "nope/missing", params: {} });

setTimeout(() => {
  proxy.stdin.end();
  proxy.kill();

  const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

  // 1) Passthrough worked: three responses came back
  const responses = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (responses.length !== 3) fail(`expected 3 responses, got ${responses.length}`);
  if (responses[0].result?.serverInfo?.name !== "mock") fail("initialize response corrupted");
  if (!responses.find((r) => r.error?.code === -32601)) fail("error response missing");

  // 2) Audit log captured traffic
  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(os.homedir(), ".mcptap", "logs", `${name}-${date}.jsonl`);
  if (!fs.existsSync(logFile)) fail(`log file not created: ${logFile}`);
  const raw = fs.readFileSync(logFile, "utf8");
  const entries = raw.trim().split("\n").map((l) => JSON.parse(l));

  const reqs = entries.filter((e) => e.kind === "request");
  const resps = entries.filter((e) => e.kind === "response");
  if (reqs.length !== 3) fail(`expected 3 logged requests, got ${reqs.length}`);
  if (resps.length !== 3) fail(`expected 3 logged responses, got ${resps.length}`);
  if (!resps.every((r) => typeof r.durationMs === "number")) fail("durations missing");
  if (!resps.find((r) => r.method === "tools/call")) fail("request/response pairing broken");
  if (raw.includes("SHOULD-BE-REDACTED")) fail("secret was NOT redacted");
  if (!raw.includes("[redacted]")) fail("redaction marker missing");

  fs.unlinkSync(logFile); // clean up
  console.log("PASS: passthrough intact, 6 entries logged, pairing + durations + redaction OK");
  process.exit(0);
}, 800);
