# mcptap — project context for AI assistants

## What this is

mcptap is an audit proxy for MCP (Model Context Protocol) servers. It sits between
an AI agent (Claude Code, Claude Desktop, Cursor, etc.) and any MCP server, transparently
forwarding all traffic while logging every tool call, argument, and response to local
JSONL files. Think "wiretap for your AI agents."

**Why it exists:** agents call tools with real side effects (file writes, API calls,
shell commands) and today that traffic is invisible. OWASP's MCP Top 10 lists "lack of
audit and telemetry" (MCP08) as a core risk. Enterprise gateways solve this for
companies; nothing lightweight exists for individual developers. mcptap is that tool:
local-first, zero-config, single command.

## How it works

The MCP stdio transport is newline-delimited JSON-RPC 2.0 over stdin/stdout.
mcptap spawns the real server as a child process and pipes traffic through unchanged:

    agent (stdin) ──▶ mcptap ──▶ real server
    agent (stdout) ◀── mcptap ◀── real server

Every line is parsed (non-destructively — the raw bytes pass through untouched)
and logged to `~/.mcptap/logs/<server>-<YYYY-MM-DD>.jsonl`. Requests and responses
are paired by JSON-RPC id to compute per-call durations.

Usage — wrap any server command in an MCP client config:

    { "command": "mcptap", "args": ["--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }

View logs: `mcptap logs`, `mcptap logs <server>`, `mcptap logs -f` (follow).

## Architecture

- `src/index.ts` — CLI entry. Routes to proxy mode (`--` separator) or `logs` viewer.
- `src/proxy.ts` — spawns child, taps both pipe directions, buffers partial lines,
  forwards signals and exit codes. MUST never corrupt or delay the passthrough stream;
  logging failures must be silent (stderr note at most), never fatal.
- `src/logger.ts` — JSONL writer. Truncates large payloads (MCPTAP_MAX_BYTES, default 4096).
- `src/viewer.ts` — reads/pretty-prints log files, supports tail-follow.

## Hard rules

1. **Passthrough integrity is sacred.** Raw bytes go through byte-for-byte. Parsing is
   for logging only. If parsing fails, log the raw line and keep piping.
2. **Never write to stdout in proxy mode** except the piped server output — stdout IS
   the protocol channel. All mcptap diagnostics go to stderr.
3. Zero runtime dependencies. Node stdlib only. devDependencies: typescript, @types/node.
4. Secrets hygiene: redact values of keys matching /token|secret|password|api[_-]?key/i
   in logged params before writing.

## Conventions

- TypeScript, strict mode, ESM (NodeNext). Node >= 18.
- Build: `npm run build` (tsc → dist/). Test: `npm test` (smoke test in test/).
- Keep it small. Resist adding features before v0.1 ships to npm + GitHub.

## Roadmap

- v0.1: passthrough + JSONL logging + `logs` viewer. Ship to npm, post to HN/Reddit.
- v0.2: `mcptap stats` (call counts, durations, error rates per server/tool).
- v0.3: config file, per-server redaction rules, HTML report export.
- Later (paid): team dashboard — aggregate logs across a team, alerts, policy checks.

## Owner

Charlie (charleselliottroger@gmail.com). Design/marketing background + systems interest;
this is the first shipped product of a longer-term software company plan. Bias every
decision toward SHIPPING v0.1, not perfecting it.
