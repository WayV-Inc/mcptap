# Getting started

The pattern is always the same: wherever your MCP client config has a server
command, prefix it with `mcptap --`.

Before:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
    }
  }
}
```

After:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcptap",
      "args": ["--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"]
    }
  }
}
```

Everything after `--` is the untouched original command.

## Where the config lives

**Claude Desktop (macOS):**
`~/Library/Application Support/Claude/claude_desktop_config.json`

**Claude Code:** project-level `.mcp.json`, or add via CLI:

```sh
claude mcp add filesystem -- mcptap -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

**Cursor:** `~/.cursor/mcp.json` (same `mcpServers` shape as Claude Desktop).

Restart the client after editing — most clients only launch servers at startup.

## See the traffic

Trigger anything that uses the server, then:

```sh
mcptap logs        # last 50 entries
mcptap logs -f     # follow live while you work
```

You should see `initialize`, `tools/list`, and every `tools/call` with its
arguments and duration. If you see nothing, check the
[FAQ](faq.md#no-logs-are-appearing).

## Naming your servers

Log files are named after the server, derived from the wrapped command. To pick
the name yourself, set an env var in the server config:

```json
{
  "command": "mcptap",
  "args": ["--", "npx", "-y", "@modelcontextprotocol/server-github"],
  "env": { "MCPTAP_NAME": "github" }
}
```
