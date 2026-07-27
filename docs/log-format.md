# Log format

Logs are JSON Lines: one JSON object per line, appended to

```
~/.mcptap/logs/<server>-<YYYY-MM-DD>.jsonl
```

Files rotate daily (a new file per server per day). Nothing is ever uploaded;
deleting the directory is the complete data-removal story.

## Entry kinds

Every entry has `ts` (ISO 8601), `server`, `dir` (`"client->server"` or
`"server->client"`), and `kind`:

**`request`** — a JSON-RPC call with an id:

```json
{"ts":"2026-07-26T14:02:15.101Z","server":"filesystem","dir":"client->server",
 "kind":"request","id":4,"method":"tools/call",
 "params":{"name":"read_file","arguments":{"path":"/tmp/notes.md"}}}
```

**`response`** — paired to its request by id; carries the original `method` and
`durationMs`. Exactly one of `result` / `error` is present:

```json
{"ts":"2026-07-26T14:02:15.104Z","server":"filesystem","dir":"server->client",
 "kind":"response","id":4,"method":"tools/call","durationMs":3,
 "result":{"content":[{"type":"text","text":"…"}]}}
```

**`notification`** — a method call without an id (no response expected).

**`raw`** — a line that wasn't valid JSON. Logged as-is (truncated) so nothing
is silently dropped.

## Redaction

Before writing, object keys matching

```
/token|secret|password|passwd|api[_-]?key|authorization|credential/i
```

have their values replaced with `"[redacted]"`, recursively, in both params and
results. This is a safety net, not a guarantee — a secret inside a plain string
value under an innocent key is not detected.

## Truncation

Strings longer than `MCPTAP_MAX_BYTES` (default 4096) are cut and suffixed with
`…[truncated N chars]`. Recursion depth is capped at 8 levels. Only the **log**
is truncated — the live traffic between client and server is never modified.

## Consuming the logs

It's plain JSONL — `jq` is your friend:

```sh
# every tool call made today, with arguments
jq -r 'select(.kind=="request" and .method=="tools/call") | "\(.ts) \(.params.name) \(.params.arguments)"' \
  ~/.mcptap/logs/filesystem-$(date +%F).jsonl

# slowest calls
jq -r 'select(.durationMs!=null) | "\(.durationMs)ms \(.method)"' ~/.mcptap/logs/*.jsonl | sort -rn | head
```
