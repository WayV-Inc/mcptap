#!/usr/bin/env node
import { runProxy } from "./proxy.js";
import { showLogs } from "./viewer.js";

const HELP = `mcptap — audit proxy for MCP servers

Usage:
  mcptap setup [clients...]         Interactive onboarding: auto-wrap your MCP
                                    client configs (Claude Code, Claude Desktop,
                                    Codex, Cursor, Windsurf, project .mcp.json)
  mcptap autopilot on|off|status    Keep configs wrapped automatically: watches
                                    client config files and wraps new MCP
                                    servers the moment they're added (macOS)
  mcptap -- <command> [args...]     Run an MCP server through the audit proxy
  mcptap logs [server] [options]    View logged traffic

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
} else if (argv[0] === "autopilot") {
  const { autopilot } = await import("./autopilot.js");
  await autopilot(argv[1] || "status", argv.slice(2).filter((a) => !a.startsWith("-")));
} else if (argv[0] === "logs") {
  const rest = argv.slice(1);
  const follow = rest.includes("-f") || rest.includes("--follow");
  const tailIdx = rest.indexOf("--tail");
  const tail = tailIdx >= 0 ? Number(rest[tailIdx + 1]) || 50 : 50;
  const server = rest.find((a) => !a.startsWith("-") && a !== String(tail));
  showLogs(server, tail, follow);
} else {
  console.log(HELP);
  process.exit(argv.length === 0 || argv[0] === "help" || argv[0] === "--help" ? 0 : 1);
}
