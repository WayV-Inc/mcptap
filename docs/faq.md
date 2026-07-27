# FAQ & troubleshooting

## Does mcptap slow my agent down?

Not measurably. The passthrough is a direct pipe; parsing happens on the side and
logging is an async append to a local file. There is no network hop.

## Can the client or server detect it?

No. Bytes pass through unmodified, stderr is inherited, exit codes and signals are
forwarded. From both sides it looks exactly like a direct connection.

## Is my data safe?

Logs never leave your machine (`~/.mcptap/logs/`). Values under secret-looking keys
are redacted before writing — see [Log format](log-format.md#redaction) for the
exact rule and its limits. If your tool traffic includes sensitive payloads under
other keys, treat the log directory with the same care as the data itself.

## Does it work with HTTP/SSE MCP servers?

Not yet — v0.1 covers the stdio transport, which is how the large majority of
local MCP servers run. HTTP transport support is on the roadmap; if you need it,
open an issue so it gets prioritized.

## No logs are appearing

1. Restart your MCP client — most only launch servers at startup, so config
   changes don't apply until then.
2. Confirm the wrap is active: the server entry's `command` should be `mcptap`
   with `--` before the original command in `args`.
3. Check `mcptap` resolves for GUI apps: run `which mcptap`. GUI-launched clients
   don't always share your shell's PATH — if needed, use the absolute path
   (output of `which mcptap`) as the `command`.
4. Look for files: `ls ~/.mcptap/logs/`. If files exist but `mcptap logs <name>`
   shows nothing, the server name differs from what you expect — run
   `mcptap logs` with no name to see everything.

## The server fails to start after wrapping

Run the wrapped form manually in a terminal:

```sh
mcptap -- npx -y @modelcontextprotocol/server-filesystem /tmp
```

Type nothing; it should sit silently (the server is waiting on stdin). Errors
printed here are from the server itself — the most common cause is an `env` block
the client was passing that you need to keep in the config.

## How do I log only some servers?

Wrap only those. mcptap is per-server by design — there's no global on/off state.

## Where do I report bugs or ask for features?

https://github.com/WayV-Inc/mcptap/issues — issues are triaged actively while
the project is young. Include the client, the wrapped command, and a snippet of
`~/.mcptap/logs/` output if relevant.
