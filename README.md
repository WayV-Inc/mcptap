<p align="center">
  <img src="assets/logo-wordmark.svg" width="320" alt="mcptap">
</p>

<p align="center"><strong>See every tool call your AI agents make.</strong></p>

mcptap is a zero-config audit proxy for [MCP](https://modelcontextprotocol.io) servers.
It sits between your AI client (Claude Code, Claude Desktop, Cursor, …) and any MCP
server, passing traffic through untouched while logging every request, response, and
tool call to local JSONL files — with arguments, results, durations, and errors.

Your agents read files, hit APIs, and run commands on your behalf. Today that traffic
is invisible. mcptap makes it visible.

- **Zero config** — wrap any server command, done
- **Local-first** — logs stay in `~/.mcptap/logs/`, nothing leaves your machine
- **Transparent** — byte-for-byte passthrough; your client and server never know it's there
- **Secret-aware** — values of keys like `token`, `password`, `api_key` are redacted before logging
- **Zero dependencies** — Node stdlib only

## Install

```sh
npm install -g @wayv-software/mcptap
```

The command is still just `mcptap`.

## Use

Wrap the server command in your MCP client config. Before:

```json
{ "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
```

After:

```json
{ "command": "mcptap", "args": ["--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
```

Then watch the traffic:

```sh
mcptap logs           # last 50 entries across all servers
mcptap logs -f        # follow live
mcptap logs server-filesystem --tail 200
```

Example output:

```
14:02:11 server-filesystem → initialize {"protocolVersion":"2025-06-18",…}
14:02:11 server-filesystem ← initialize ok (12ms)
14:02:15 server-filesystem → tools/call {"name":"read_file","arguments":{"path":"/tmp/notes.md"}}
14:02:15 server-filesystem ← tools/call ok (3ms)
14:02:20 server-filesystem → tools/call {"name":"write_file","arguments":{"path":"/etc/passwd",…}}
14:02:20 server-filesystem ← tools/call ERROR (1ms) {"code":-32000,"message":"Access denied"}
```

Raw JSONL lives in `~/.mcptap/logs/<server>-<date>.jsonl` — pipe it into `jq`, ship it
wherever you like.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MCPTAP_NAME` | derived from command | Server name used in logs |
| `MCPTAP_MAX_BYTES` | `4096` | Truncate logged payloads beyond this size |

## Why

OWASP's MCP Top 10 lists *lack of audit and telemetry* (MCP08) as a core risk of
agentic systems. Enterprise gateways solve it for companies; nothing lightweight
existed for the individual developer. mcptap is the `tcpdump` of MCP: one command,
full visibility.

## License

MIT
