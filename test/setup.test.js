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

// Fixture: Claude Code config with one plain stdio server, one http, one pre-wrapped,
// plus a project-scoped server nested under `projects`
fs.writeFileSync(path.join(fix, ".claude.json"), JSON.stringify({
  someOtherState: { keep: true },
  mcpServers: {
    fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
    web: { type: "http", url: "https://example.com/mcp" },
    done: { command: "mcptap", args: ["--", "node", "x.js"] },
  },
  projects: {
    "/Users/x/proj": {
      allowedTools: ["keep"],
      mcpServers: { projsrv: { command: "python3", args: ["server.py"] } },
    },
  },
}, null, 2));

// Fixture: VS Code user mcp.json ("servers" key) — path depends on platform
const vsUser = process.platform === "darwin"
  ? path.join(fix, "Library", "Application Support", "Code", "User")
  : process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(fix, "AppData", "Roaming"), "Code", "User")
    : path.join(fix, ".config", "Code", "User");
fs.mkdirSync(vsUser, { recursive: true });
fs.writeFileSync(path.join(vsUser, "mcp.json"), JSON.stringify({
  servers: { memory: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] } },
}, null, 2));

// Fixture: Zed settings with object-style command
const zedDir = path.join(fix, ".config", "zed");
fs.mkdirSync(zedDir, { recursive: true });
fs.writeFileSync(path.join(zedDir, "settings.json"), JSON.stringify({
  theme: "One Dark",
  context_servers: { docs: { command: { path: "uvx", args: ["mcp-server-docs"] } } },
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
run("claude-code", "codex", "vscode", "zed", "--yes");

// Wrapped form is GUI-safe: absolute node + absolute mcptap script
const NODE = process.execPath;
const SCRIPT = path.resolve(here, "..", "dist", "index.js");

const vs = JSON.parse(fs.readFileSync(path.join(vsUser, "mcp.json"), "utf8"));
if (vs.servers.memory.command !== NODE) fail("vscode servers-key not wrapped with abs node");
if (vs.servers.memory.args[0] !== SCRIPT || vs.servers.memory.args[1] !== "--") fail("vscode args not GUI-safe form");

const zed = JSON.parse(fs.readFileSync(path.join(zedDir, "settings.json"), "utf8"));
if (zed.context_servers.docs.command.path !== NODE) fail("zed object command not wrapped");
if (JSON.stringify(zed.context_servers.docs.command.args) !== JSON.stringify([SCRIPT, "--", "uvx", "mcp-server-docs"])) fail("zed args wrong");
if (zed.theme !== "One Dark") fail("zed settings clobbered");

const cc = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (cc.mcpServers.fs.command !== NODE) fail("fs not wrapped with abs node");
if (JSON.stringify(cc.mcpServers.fs.args) !== JSON.stringify([SCRIPT, "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"])) fail("fs args wrong");
if (cc.mcpServers.web.url !== "https://example.com/mcp") fail("http server touched");
if (cc.mcpServers.done.args[1] !== "node") fail("legacy-wrapped server double-wrapped");
if (!cc.someOtherState?.keep) fail("unrelated state lost");
if (cc.projects["/Users/x/proj"].mcpServers.projsrv.command !== NODE) fail("nested project server not wrapped");
if (cc.projects["/Users/x/proj"].allowedTools[0] !== "keep") fail("project state lost");

let toml = fs.readFileSync(path.join(fix, ".codex", "config.toml"), "utf8");
if (!toml.includes(`command = ${JSON.stringify(NODE)}`)) fail("codex not wrapped with abs node");
if (!toml.includes(`args = [${JSON.stringify(SCRIPT)}, "--", "npx", "-y", "@modelcontextprotocol/server-github"]`)) fail("codex github args wrong");
if (!toml.includes(`args = [${JSON.stringify(SCRIPT)}, "--", "node"]`)) fail("codex argless server not wrapped");
if (!toml.includes('env = { "GITHUB_TOKEN" = "x" }')) fail("codex env line lost");
if (!toml.includes("[other]")) fail("unrelated toml section lost");

if (!fs.readdirSync(fix).some((f) => f.startsWith(".claude.json.mcptap-backup-"))) fail("no backup created");

// --- idempotency ---
run("claude-code", "codex", "vscode", "zed", "--yes");
const cc2 = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (cc2.mcpServers.fs.args.filter((a) => a === "--").length !== 1) fail("not idempotent");
const zed2 = JSON.parse(fs.readFileSync(path.join(zedDir, "settings.json"), "utf8"));
if (zed2.context_servers.docs.command.args.filter((a) => a === "--").length !== 1) fail("zed not idempotent");

// --- undo ---
run("claude-code", "codex", "vscode", "zed", "--yes", "--undo");
const vs3 = JSON.parse(fs.readFileSync(path.join(vsUser, "mcp.json"), "utf8"));
if (vs3.servers.memory.command !== "npx") fail("vscode undo failed");
const zed3 = JSON.parse(fs.readFileSync(path.join(zedDir, "settings.json"), "utf8"));
if (zed3.context_servers.docs.command.path !== "uvx") fail("zed undo failed");
const ccU = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (ccU.projects["/Users/x/proj"].mcpServers.projsrv.command !== "python3") fail("nested undo failed");
const cc3 = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (cc3.mcpServers.fs.command !== "npx") fail("undo failed for fs");
if (JSON.stringify(cc3.mcpServers.fs.args) !== JSON.stringify(["-y", "@modelcontextprotocol/server-filesystem", "/tmp"])) fail("undo args wrong");
toml = fs.readFileSync(path.join(fix, ".codex", "config.toml"), "utf8");
if (!toml.includes('command = "npx"')) fail("undo failed for codex");
if (toml.includes("mcptap")) fail("mcptap remnants after undo");

// --- autopilot plist renderer ---
const { renderPlist } = await import("../dist/autopilot.js");
const plist = renderPlist("/usr/local/bin/node", "/x/dist/index.js", ["claude-code", "codex"], ["/Users/x/.claude.json", "/Users/x/.codex/config.toml"], "/Users/x/.mcptap/autopilot.log");
if (!plist.includes("<string>setup</string>")) fail("plist missing setup arg");
if (!plist.includes("<string>claude-code</string>")) fail("plist missing client id");
if (!plist.includes("<string>--yes</string>")) fail("plist missing --yes");
if (!plist.includes("<key>WatchPaths</key>")) fail("plist missing WatchPaths");
if (!plist.includes("<string>/Users/x/.claude.json</string>")) fail("plist missing watch path");
if (!plist.includes("<key>ThrottleInterval</key>")) fail("plist missing throttle");

fs.rmSync(fix, { recursive: true, force: true });
console.log("PASS: setup wrap/idempotency/undo OK for JSON + TOML; autopilot plist OK");
