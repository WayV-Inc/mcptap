# CLI reference

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
