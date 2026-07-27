#!/usr/bin/env node
// Tests for `mcptap add`: provisioning wrapped servers into JSON + TOML configs,
// file creation for dedicated configs, and duplicate protection.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "dist", "index.js");
const fix = fs.mkdtempSync("/tmp/mcptap-add-");
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

const NODE = process.execPath;
const SCRIPT = path.resolve(here, "..", "dist", "index.js");

fs.writeFileSync(path.join(fix, ".claude.json"), JSON.stringify({ existing: true }, null, 2));
fs.mkdirSync(path.join(fix, ".codex"), { recursive: true });
fs.writeFileSync(path.join(fix, ".codex", "config.toml"), `model = "o4"\n\n[mcp_servers.github]\ncommand = "npx"\n`);

const run = (...args) =>
  execFileSync("node", [entry, "add", ...args], { env: { ...process.env, MCPTAP_HOME: fix }, encoding: "utf8" });

run("memory", "filesystem", "--to", "claude-code,cursor,codex", "--dir", "/tmp/safe", "--yes");

// JSON target (existing file)
const cc = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (!cc.existing) fail("existing state lost");
const mem = cc.mcpServers?.memory;
if (!mem) fail("memory not added to claude-code");
if (mem.command !== NODE) fail("memory not wrapped with abs node");
if (mem.args[0] !== SCRIPT || mem.args[1] !== "--" || mem.args[2] !== "npx") fail("memory args wrong");
if (mem.env?.MCPTAP_NAME !== "memory") fail("MCPTAP_NAME missing");
const fsrv = cc.mcpServers?.filesystem;
if (!fsrv || fsrv.args[fsrv.args.length - 1] !== "/tmp/safe") fail("filesystem dir not applied");

// JSON target (file created)
const cursor = JSON.parse(fs.readFileSync(path.join(fix, ".cursor", "mcp.json"), "utf8"));
if (!cursor.mcpServers?.memory || !cursor.mcpServers?.filesystem) fail("cursor config not created with servers");

// TOML target
const toml = fs.readFileSync(path.join(fix, ".codex", "config.toml"), "utf8");
if (!toml.includes("[mcp_servers.memory]")) fail("codex memory section missing");
if (!toml.includes(`command = ${JSON.stringify(NODE)}`)) fail("codex abs node missing");
if (!toml.includes(`env = { "MCPTAP_NAME" = "memory" }`)) fail("codex env missing");
if (!toml.includes("[mcp_servers.github]")) fail("existing codex section lost");

// Duplicate protection
run("memory", "--to", "claude-code,codex", "--yes");
const cc2 = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (JSON.stringify(cc2.mcpServers.memory) !== JSON.stringify(mem)) fail("duplicate add changed entry");
const toml2 = fs.readFileSync(path.join(fix, ".codex", "config.toml"), "utf8");
if ((toml2.match(/\[mcp_servers\.memory\]/g) || []).length !== 1) fail("duplicate toml section");

// Added servers must be recognized as already-wrapped by setup (no double wrap)
execFileSync("node", [entry, "setup", "claude-code", "--yes"], { env: { ...process.env, MCPTAP_HOME: fix }, encoding: "utf8" });
const cc3 = JSON.parse(fs.readFileSync(path.join(fix, ".claude.json"), "utf8"));
if (cc3.mcpServers.memory.args.filter((a) => a === "--").length !== 1) fail("setup double-wrapped an added server");

fs.rmSync(fix, { recursive: true, force: true });
console.log("PASS: add provisioning OK — JSON, TOML, file creation, dup protection, setup interop");
