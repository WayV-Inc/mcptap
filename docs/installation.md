# Installation

## Requirements

- Node.js 18 or newer
- Any MCP client that launches stdio servers (Claude Desktop, Claude Code, Cursor, …)

mcptap has **zero runtime dependencies** — it's Node stdlib only.

## Global install (recommended)

```sh
npm install -g @wayv-software/mcptap
```

This puts the `mcptap` command on your PATH. Verify:

```sh
mcptap --help
```

## Without installing

You can invoke it through npx inside a client config:

```json
{ "command": "npx", "args": ["-y", "@wayv-software/mcptap", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }
```

Global install is preferred — it shaves startup latency off every server launch.

## Uninstall

```sh
npm uninstall -g @wayv-software/mcptap
rm -rf ~/.mcptap        # removes all logs
```

mcptap writes nothing anywhere else.
