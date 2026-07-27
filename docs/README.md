# mcptap documentation

mcptap is a transparent audit proxy for MCP (Model Context Protocol) servers over
the stdio transport. It logs every request, response, and tool call your AI agents
make — locally, with zero configuration.

## Contents

- [Installation](installation.md) — requirements and install options
- [Getting started](getting-started.md) — wrap your first server, client config examples
- [CLI reference](cli-reference.md) — every command, flag, and environment variable
- [Log format](log-format.md) — the JSONL schema, redaction, truncation, rotation
- [FAQ & troubleshooting](faq.md) — common questions and fixes

## How it works in one paragraph

The MCP stdio transport is newline-delimited JSON-RPC 2.0 over stdin/stdout. mcptap
spawns your real server as a child process and pipes bytes through untouched in both
directions. On the side, it parses each complete line, pairs responses to requests by
JSON-RPC id, computes durations, redacts secret-looking values, and appends structured
entries to `~/.mcptap/logs/`. If parsing ever fails, the raw line is logged and the
passthrough continues — logging can never break your session.
