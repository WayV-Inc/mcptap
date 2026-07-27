#!/usr/bin/env node
// Regression tests for two bugs found by dogfooding v0.5.0:
//  1. `a` in the picker toggled — pressing it when everything was already
//     checked silently deselected everything.
//  2. `mcptap watch` exited instantly when stdin had buffered keystrokes.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

// --- 1. "a" selects all, "n" clears; neither toggles ---
const { checkboxes } = await import("../dist/tui.js");
const src = fs.readFileSync(path.join(here, "..", "dist", "tui.js"), "utf8");
if (/const any = items\.some/.test(src)) fail('"a" still uses toggle semantics');
if (!/key\.name === "a"/.test(src) || !/key\.name === "n"/.test(src)) fail("a/n handlers missing");
if (!/n none/.test(src)) fail("help line does not document 'n'");
if (typeof checkboxes !== "function") fail("checkboxes not exported");

// --- 2. watch survives buffered stdin and keeps running ---
const w = spawn("node", [entry, "watch"], {
  env: { ...process.env, COLUMNS: "90", LINES: "30" },
  stdio: ["pipe", "pipe", "inherit"],
});
let out = "";
w.stdout.on("data", (c) => (out += c.toString()));
w.stdin.write("\x1b[A\n\x1b");          // stray arrow-key sequence + lone ESC
await new Promise((r) => setTimeout(r, 1200));
const aliveAfterNoise = w.exitCode === null;
if (!aliveAfterNoise) fail(`watch exited on buffered input (code ${w.exitCode})`);
if (!/waiting for traffic/.test(out)) fail("watch did not render an empty state");

// The 'q' handler only binds on a real TTY (stdin here is a pipe), so verify
// the signal path instead: SIGINT must exit cleanly and restore the screen.
w.kill("SIGINT");
await new Promise((r) => setTimeout(r, 700));
if (w.exitCode === null) { w.kill("SIGKILL"); fail("watch ignored SIGINT"); }
if (!out.includes("\x1b[?1049l")) fail("watch did not leave the alternate screen on exit");

// Guard the TTY quit path by construction
const wsrc = fs.readFileSync(path.join(here, "..", "dist", "watch.js"), "utf8");
if (!/s === "q"/.test(wsrc)) fail("q quit handler missing");
if (/s === "\\x1b"/.test(wsrc)) fail("bare ESC still quits — arrow keys will kill the dashboard");
if (!/accepting/.test(wsrc)) fail("buffered-input guard missing");

console.log("PASS: picker a/n semantics fixed; watch survives buffered input, exits cleanly on SIGINT");

// --- 3. per-server uptime is seeded from log backlog (real connection start),
//     not "time since watch happened to notice" — and backlog isn't double-counted ---
{
  const logDir = path.join(os.homedir(), ".mcptap", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  // Short on purpose: the dashboard truncates server names past 18 chars in the
  // summary row, so a longer name would never appear literally in the output.
  const connName = "ct" + (Date.now() % 1000000);
  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(logDir, `${connName}-${date}.jsonl`);

  const oldTs = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const backlog = [
    { ts: oldTs, server: connName, dir: "client->server", kind: "request", id: 1, method: "initialize",
      params: {}, clientInfo: { name: "old-client", version: "9.9.9" } },
    { ts: oldTs, server: connName, dir: "server->client", kind: "response", id: 1, method: "initialize",
      durationMs: 5, result: { protocolVersion: "2025-06-18" } },
    { ts: oldTs, server: connName, dir: "client->server", kind: "request", id: 2, method: "tools/call",
      params: { name: "old_tool" } },
    { ts: oldTs, server: connName, dir: "server->client", kind: "response", id: 2, method: "tools/call",
      durationMs: 3, result: { content: [] } },
  ];
  fs.writeFileSync(logFile, backlog.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const w2 = spawn("node", [entry, "watch"], {
    env: { ...process.env, COLUMNS: "100", LINES: "40" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  let out2 = "";
  w2.stdout.on("data", (c) => (out2 += c.toString()));
  await new Promise((r) => setTimeout(r, 500)); // let the first poll tick record the backlog

  // Now simulate a live call from this already-connected server.
  const liveTs = new Date().toISOString();
  const live = [
    { ts: liveTs, server: connName, dir: "client->server", kind: "request", id: 3, method: "tools/call",
      params: { name: "new_tool" } },
    { ts: liveTs, server: connName, dir: "server->client", kind: "response", id: 3, method: "tools/call",
      durationMs: 4, result: { content: [] } },
  ];
  fs.appendFileSync(logFile, live.map((l) => JSON.stringify(l)).join("\n") + "\n");
  await new Promise((r) => setTimeout(r, 1200));

  w2.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 500));
  if (w2.exitCode === null) { w2.kill("SIGKILL"); fail("watch (backlog test) ignored SIGINT"); }
  fs.unlinkSync(logFile);

  const clean2 = out2.replace(/\x1b\[[0-9;]*m/g, "");
  const lastFrame2 = clean2.split(/\x1b\[H\x1b\[2J/).filter(Boolean).pop() ?? clean2;
  // First occurrence within the frame is the summary-table row (server names also
  // reappear later in the feed section further down the same frame).
  const idx = lastFrame2.indexOf(connName);
  if (idx === -1) fail("backlog test: server row never appeared");
  const block = lastFrame2.slice(idx, idx + 300);

  // Live calls must be exactly 1 (the new call) — proves the two old backlog
  // request/response pairs were NOT ingested into the live counters.
  const row = block.split("\n")[0];
  const callsField = row.slice(20, 28).trim();
  if (callsField !== "1") fail(`backlog test: expected calls=1 (backlog not double-counted), got ${JSON.stringify(callsField)} — row: ${JSON.stringify(row)}`);

  // Uptime must reflect the OLD initialize (~90m ago), not "just now".
  const upMatch = block.match(/up (\d+)m/);
  if (!upMatch || Number(upMatch[1]) < 88) fail(`backlog test: uptime not seeded from backlog — block: ${JSON.stringify(block)}`);
  if (!block.includes("old-client")) fail(`backlog test: clientInfo not seeded from backlog — block: ${JSON.stringify(block)}`);
}
console.log("PASS: per-server uptime seeded from log backlog; live counters unaffected by backlog");

// --- 4. dashboard no longer hard-caps the server table at 6, and tells you
//     when it can't show everything rather than silently dropping rows ---
{
  const logDir = path.join(os.homedir(), ".mcptap", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  // Short on purpose: server names past 18 chars get truncated in the summary row.
  const prefix = "cd" + (Date.now() % 100000);
  const files = Array.from({ length: 10 }, (_, i) => path.join(logDir, `${prefix}${i}-${date}.jsonl`));

  const mkPair = (id, ts, server) => [
    { ts, server, dir: "client->server", kind: "request", id, method: "tools/call", params: { name: "t" } },
    { ts, server, dir: "server->client", kind: "response", id, method: "tools/call", durationMs: 1, result: { content: [] } },
  ];
  // Backlog write first (ignored on first sight), matching real rotation.
  const t0 = new Date().toISOString();
  files.forEach((f, i) => {
    const lines = mkPair(1, t0, `${prefix}${i}`);
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  });

  // Start BOTH instances now, so each completes its own backlog-ignoring first
  // poll before any new data exists — otherwise an instance started after the
  // live append below would see everything as backlog and show nothing at all.
  const wide = spawn("node", [entry, "watch"], {
    env: { ...process.env, COLUMNS: "100", LINES: "60" }, // enough room: cap-removal should show all 10
    stdio: ["pipe", "pipe", "inherit"],
  });
  let outWide = "";
  wide.stdout.on("data", (c) => (outWide += c.toString()));

  const narrow = spawn("node", [entry, "watch"], {
    env: { ...process.env, COLUMNS: "100", LINES: "14" }, // too little room: must show an overflow note
    stdio: ["pipe", "pipe", "inherit"],
  });
  let outNarrow = "";
  narrow.stdout.on("data", (c) => (outNarrow += c.toString()));

  await new Promise((r) => setTimeout(r, 500)); // both complete their first (backlog-ignoring) poll

  const t1 = new Date().toISOString();
  files.forEach((f, i) => {
    const lines = mkPair(2, t1, `${prefix}${i}`);
    fs.appendFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  });
  await new Promise((r) => setTimeout(r, 1300)); // both ingest + render the now-live traffic

  wide.kill("SIGINT"); narrow.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 500));
  if (wide.exitCode === null) wide.kill("SIGKILL");
  if (narrow.exitCode === null) narrow.kill("SIGKILL");
  files.forEach((f) => fs.unlinkSync(f));

  const cleanWide = outWide.replace(/\x1b\[[0-9;]*m/g, "");
  const lastFrameWide = cleanWide.split(/\x1b\[H\x1b\[2J/).filter(Boolean).pop() ?? cleanWide;
  const shownWide = new Set([...lastFrameWide.matchAll(new RegExp(`${prefix}\\d+`, "g"))].map((m) => m[0])).size;
  if (shownWide <= 6) fail(`cap-removal test: expected more than 6 of the 10 servers shown on a wide terminal, saw ${shownWide}`);

  const cleanNarrow = outNarrow.replace(/\x1b\[[0-9;]*m/g, "");
  const lastFrameNarrow = cleanNarrow.split(/\x1b\[H\x1b\[2J/).filter(Boolean).pop() ?? cleanNarrow;
  if (!/\+\d+ more — see mcptap stats/.test(lastFrameNarrow)) fail(`cap-removal test: overflow note missing on narrow terminal — frame: ${JSON.stringify(lastFrameNarrow.slice(0, 500))}`);
}
console.log("PASS: dashboard server table isn't hard-capped at 6; shows an overflow note when rows don't fit");
