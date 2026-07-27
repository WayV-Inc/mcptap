#!/usr/bin/env node
// Tests for `mcptap setup`: wrap + idempotency + undo across JSON and TOML,
// using a fixture home dir via MCPTAP_HOME.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");
const fix = fs.mkdtempSync("/tmp/mcptap-setup-");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

// Fixture: Claude Code config with one plain stdio server, one http, one pre-wrapped
fs.writeFileSync(path.join(fix, ".claude.json"), JSON.stringify({
  someOtherState: { keep: true },
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
    web: { type: "http", url: "https://example.com/mcp" },
    done: { command: "mcptap", args: ["--", "node", "x.js"] },
  },
}, null, 2));

// Fixture: Codex TOML with one server (no args line) and one with args
fs.mkdirSync(path.join(fix, ".codex"), { recursive: true });
fs.writeFileSync(path.join(fix, ".codex", "config.toml"), `model = "o4"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { "GITHUB_TOKEN" = "x" }

[mcp_servers.local]
command = "node"

[other]
keep = true
`);

const run = (...args) =>
  execFileSync("node", [entry, "setup", ...args], { env: { ...process.env, MCPTAP_HOME: fix }, encoding: "utf8" });

// --- wrap ---
run("claude-code", "codex", "--yes");

const cc = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (cc.mcpServers.fs.command !== "mcptap") fail("fs not wrapped");
if (JSON.stringify(cc.mcpServers.fs.args) !== JSON.stringify(["--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"])) fail("fs args wrong");
if (cc.mcpServers.web.url !== "https://example.com/mcp") fail("http server touched");
if (cc.mcpServers.done.args[1] !== "node") fail("pre-wrapped server double-wrapped");
if (!cc.someOtherState?.keep) fail("unrelated state lost");

let toml = fs.readFileSync(path.join(fix, ".codex", "config.toml"), "utf8");
if (!toml.includes('command = "mcptap"')) fail("codex not wrapped");
if (!toml.includes('args = ["--", "npx", "-y", "@modelcontextprotocol/server-github"]')) fail("codex github args wrong");
if (!toml.includes('args = ["--", "node"]')) fail("codex argless server not wrapped");
if (!toml.includes('env = { "GITHUB_TOKEN" = "x" }')) fail("codex env line lost");
if (!toml.includes("[other]")) fail("unrelated toml section lost");

if (!fs.readdirSync(fix).some((f) => f.startsWith(".claude.json.mcptap-backup-"))) fail("no backup created");

// --- idempotency ---
run("claude-code", "codex", "--yes");
const cc2 = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (cc2.mcpServers.fs.args.filter((a) => a === "--").length !== 1) fail("not idempotent");

// --- undo ---
run("claude-code", "codex", "--yes", "--undo");
const cc3 = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (cc3.mcpServers.fs.command !== "npx") fail("undo failed for fs");
if (JSON.stringify(cc3.mcpServers.fs.args) !== JSON.stringify(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])) fail("undo args wrong");
toml = fs.readFileSync(path.join(fix, ".codex", "config.toml"), "utf8");
if (!toml.includes('command = "npx"')) fail("undo failed for codex");
if (toml.includes("mcptap")) fail("mcptap remnants after undo");

fs.rmSync(fix, { recursive: true, force: true });
console.log("PASS: setup wrap/idempotency/undo OK for JSON + TOML");
