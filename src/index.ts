#!/usr/bin/env node
import { createRequire } from "node:module";
import { runProxy } from "./proxy.js";
import { showLogs } from "./viewer.js";

const VERSION: string = createRequire(import.meta.url)("../package.json").version;

const HELP = `mcptap — audit proxy for MCP servers

Usage:
  mcptap setup [clients...]         Interactive onboarding: auto-wrap your MCP
                                    client configs (Claude Code, Claude Desktop,
                                    Codex, Cursor, Windsurf, project .mcp.json)
  mcptap add [servers...]           Install ready-to-use MCP servers into your
                                    clients, pre-wrapped for logging. Catalog:
                                    filesystem, memory, sequential-thinking,
                                    everything. Flags: --to <ids>, --dir <path>
  mcptap autopilot on|off|status    Keep configs wrapped automatically: watches
                                    client config files and wraps new MCP
                                    servers the moment they're added (macOS)
  mcptap -- <command> [args...]     Run an MCP server through the audit proxy
  mcptap logs [server] [options]    View logged traffic (--json for raw JSONL)
  mcptap watch [server]             Live dashboard: throughput, per-server and
                                    per-tool activity, tool-change alerts
  mcptap trust --reset [server]     Forget tool fingerprints; next tools/list
                                    becomes the new trusted baseline
  mcptap stats [server]             Call counts, error rates, and latency
                                    per server and tool

Options for setup:
  --yes        Apply without the interactive picker (needed when not a TTY)
  --undo       Reverse: unwrap servers back to their original commands

Options for logs:
  --tail N     Show last N entries (default 50)
  -f           Follow new entries live

Examples:
  mcptap -- npx -y @modelcontextprotocol/server-filesystem /tmp
  mcptap logs
  mcptap logs server-filesystem -f

In an MCP client config, wrap the command:
  { "command": "mcptap", "args": ["--", "npx", "-y", "@modelcontextprotocol/server-github"] }

Logs are written to ~/.mcptap/logs/ as JSONL. Set MCPTAP_NAME to override the
server name, MCPTAP_MAX_BYTES to change payload truncation (default 4096).
`;

const argv = process.argv.slice(2);

const sep = argv.indexOf("--");
if (sep >= 0) {
  const [cmd, ...args] = argv.slice(sep + 1);
  if (!cmd) {
    process.stderr.write("mcptap: no command after --\n");
    process.exit(1);
  }
  runProxy(cmd, args);
} else if (argv[0] === "setup") {
  const rest = argv.slice(1);
  const undo = rest.includes("--undo");
  const yes = rest.includes("--yes") || rest.includes("--all");
  const ids = rest.filter((a) => !a.startsWith("-"));
  const { runSetup } = await import("./setup-cli.js");
  await runSetup(ids, { undo, yes });
} else if (argv[0] === "add") {
  const { runAdd } = await import("./add.js");
  await runAdd(argv.slice(1));
} else if (argv[0] === "autopilot") {
  const { autopilot } = await import("./autopilot.js");
  await autopilot(argv[1] || "status", argv.slice(2).filter((a) => !a.startsWith("-")));
} else if (argv[0] === "logs") {
  const rest = argv.slice(1);
  const follow = rest.includes("-f") || rest.includes("--follow");
  const json = rest.includes("--json");
  const tailIdx = rest.indexOf("--tail");
  const tail = tailIdx >= 0 ? Number(rest[tailIdx + 1]) || 50 : 50;
  const server = rest.find((a) => !a.startsWith("-") && a !== String(tail));
  showLogs(server, tail, follow, json);
} else if (argv[0] === "trust") {
  const { resetBaseline } = await import("./tools.js");
  if (argv.includes("--reset")) {
    const server = argv.slice(1).find((a) => !a.startsWith("-"));
    const n = resetBaseline(server);
    console.log(`Reset tool baselines for ${n} server${n === 1 ? "" : "s"}. The next tools/list re-establishes them.`);
  } else {
    console.log("Usage: mcptap trust --reset [server]");
    process.exitCode = 1;
  }
} else if (argv[0] === "watch") {
  const { runWatch } = await import("./watch.js");
  runWatch(argv.slice(1).find((a) => !a.startsWith("-")));
} else if (argv[0] === "stats") {
  const { showStats } = await import("./stats.js");
  showStats(argv.slice(1).find((a) => !a.startsWith("-")));
} else if (argv[0] === "--version" || argv[0] === "-v" || argv[0] === "version") {
  console.log(VERSION);
} else {
  console.log(HELP);
  process.exit(argv.length === 0 || argv[0] === "help" || argv[0] === "--help" ? 0 : 1);
}
