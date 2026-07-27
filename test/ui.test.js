#!/usr/bin/env node
// Regression tests for two bugs found by dogfooding v0.5.0:
//  1. `a` in the picker toggled — pressing it when everything was already
//     checked silently deselected everything.
//  2. `mcptap watch` exited instantly when stdin had buffered keystrokes.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
