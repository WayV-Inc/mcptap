# CLI reference

## `mcptap setup [clients...] [--yes] [--undo]`

Interactive onboarding. Detects installed MCP clients, shows how many stdio
servers each config has, and wraps the ones you select with `mcptap --`.

| Client id | Config file |
|---|---|
| `claude-code` | `~/.claude.json` — global servers **and** per-project servers under `projects` |
| `claude-desktop` | `~/Library/Application Support/Claude/claude_desktop_config.json` (per-platform) |
| `codex` | `~/.codex/config.toml` (TOML) |
| `cursor` | `~/.cursor/mcp.json` |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` |
| `vscode` | VS Code user profile `mcp.json` (`servers` key) |
| `vscode-insiders` | VS Code Insiders user profile `mcp.json` |
| `cline` | Cline extension `cline_mcp_settings.json` |
| `roo` | Roo Code extension `mcp_settings.json` |
| `gemini` | `~/.gemini/settings.json` |
| `lmstudio` | `~/.lmstudio/mcp.json` |
| `zed` | `~/.config/zed/settings.json` (`context_servers`, object-style commands supported) |
| `project` | `./.mcp.json` in the current folder |

Safety behavior: a timestamped backup is written next to any file before it's
modified; already-wrapped servers are skipped (idempotent); HTTP/SSE servers are
left untouched; Codex TOML servers with arguments the parser can't handle safely
are skipped with a note rather than guessed at.

Flags: name client ids to skip the picker (`mcptap setup claude-code codex --yes`);
`--yes` applies to all detected clients without prompting (required when no TTY);
`--undo` reverses the wrap, restoring original commands.

## `mcptap add [servers...] [--to ids] [--dir path]`

Installs ready-to-use MCP servers into your clients, already wrapped, so they're
logged from their very first call. Interactive by default; scriptable with flags:

```sh
mcptap add                                       # pick servers and clients from lists
mcptap add memory --to claude-code,cursor --yes  # non-interactive
mcptap add filesystem --dir ~/Projects --yes     # scope the filesystem server
```

Catalog (all zero-config, official reference servers): `filesystem` (read/write a
folder you choose), `memory` (persistent knowledge-graph memory),
`sequential-thinking` (structured reasoning), `everything` (demo/test server).

Dedicated config files (Cursor, Claude Desktop, LM Studio, VS Code, …) are created
if missing; app-managed files (`~/.claude.json`, Codex TOML, Zed settings) are only
edited, never created. Existing server names are never overwritten, and every
modified file gets a timestamped backup.

## `mcptap autopilot on|off|status`

Always-on mode (macOS). Installs a launchd LaunchAgent that watches your client
config files and runs `mcptap setup --yes` the moment one changes — so any MCP
server you add later, in any wrapped client, gets wrapped automatically without
thinking about it. `setup` offers to enable this at the end of an interactive run.

- `on [clients...]` — watch all clients, or only the listed ids
- `off` — remove the agent (existing wraps stay; `setup --undo` removes those)
- `status` — installed or not, plus recent activity from `~/.mcptap/autopilot.log`

Loop safety: the wrap is idempotent, so the config write it performs doesn't
re-trigger meaningful work, and launchd throttles runs to at most one per 10s.

On Linux, the equivalent is a systemd user path unit watching your configs and
running `mcptap setup --yes`.

## `mcptap -- <command> [args...]`

Runs `<command>` as a child process and proxies its stdio, logging all MCP
traffic. Everything after `--` is executed verbatim.

Behavior guarantees:

- stdout/stdin pass through **byte-for-byte** — parsing is for logging only
- stderr of the wrapped server passes straight through
- the child's exit code becomes mcptap's exit code
- `SIGINT`, `SIGTERM`, and `SIGHUP` are forwarded to the child
- a logging failure (full disk, bad permissions) never interrupts the proxy

## `mcptap logs [server] [options]`

Prints logged traffic, oldest first, colorized.

| Option | Effect |
|---|---|
| `[server]` | Only entries for servers whose log files start with this name |
| `--tail N` | Show the last N entries (default 50) |
| `-f`, `--follow` | After printing, follow the newest log file live (0.5s poll) |

Output line anatomy:

```
14:02:15 server-filesystem → tools/call {"name":"read_file",…}   ← request + params
14:02:15 server-filesystem ← tools/call ok (3ms)                 ← response + duration
14:02:20 server-filesystem ← tools/call ERROR (1ms) {"code":…}   ← error response
14:02:21 server-filesystem · notifications/progress              ← notification
```

## `mcptap help`

Prints usage. Also shown when run with no arguments.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MCPTAP_NAME` | derived from the wrapped command | Server name used for log files and display |
| `MCPTAP_MAX_BYTES` | `4096` | Strings longer than this are truncated in logs (the live traffic is never truncated) |

Name derivation when `MCPTAP_NAME` is unset: the last argument that isn't a flag
or an absolute path (e.g. the npm package name), basename taken, non-alphanumerics
replaced with `_`.
