import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MAX_BYTES = Number(process.env.MCPTAP_MAX_BYTES || 4096);
const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|credential/i;

export const LOG_DIR = path.join(os.homedir(), ".mcptap", "logs");

export type Direction = "client->server" | "server->client";

export interface LogEntry {
  ts: string;
  server: string;
  dir: Direction;
  kind: "request" | "response" | "notification" | "raw";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  durationMs?: number;
  raw?: string;
}

/** Recursively redact secret-looking keys and truncate big strings. */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limit]";
  if (typeof value === "string") {
    return value.length > MAX_BYTES
      ? value.slice(0, MAX_BYTES) + `…[truncated ${value.length - MAX_BYTES} chars]`
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class AuditLogger {
  private stream: fs.WriteStream | null = null;
  private currentDate = "";
  private pending = new Map<string | number, { method: string; at: number }>();

  constructor(private server: string) {}

  private getStream(): fs.WriteStream | null {
    const date = new Date().toISOString().slice(0, 10);
    if (!this.stream || date !== this.currentDate) {
      try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        this.stream?.end();
        this.currentDate = date;
        this.stream = fs.createWriteStream(
          path.join(LOG_DIR, `${this.server}-${date}.jsonl`),
          { flags: "a" }
        );
        this.stream.on("error", () => { this.stream = null; });
      } catch {
        this.stream = null; // logging must never kill the proxy
      }
    }
    return this.stream;
  }

  private write(entry: LogEntry): void {
    try {
      this.getStream()?.write(JSON.stringify(entry) + "\n");
    } catch {
      /* never fatal */
    }
  }

  /** Log a parsed JSON-RPC message. */
  message(dir: Direction, msg: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const id = msg.id as string | number | undefined;
    const method = msg.method as string | undefined;

    if (method !== undefined && id !== undefined) {
      // request
      this.pending.set(id, { method, at: Date.now() });
      this.write({ ts, server: this.server, dir, kind: "request", id, method,
        params: sanitize(msg.params) });
    } else if (method !== undefined) {
      // notification
      this.write({ ts, server: this.server, dir, kind: "notification", method,
        params: sanitize(msg.params) });
    } else if (id !== undefined) {
      // response
      const req = this.pending.get(id);
      if (req) this.pending.delete(id);
      this.write({
        ts, server: this.server, dir, kind: "response", id,
        method: req?.method,
        durationMs: req ? Date.now() - req.at : undefined,
        ...(msg.error !== undefined
          ? { error: sanitize(msg.error) }
          : { result: sanitize(msg.result) }),
      });
    }
  }

  /** Log a line that failed to parse as JSON. */
  raw(dir: Direction, line: string): void {
    this.write({
      ts: new Date().toISOString(), server: this.server, dir, kind: "raw",
      raw: line.length > MAX_BYTES ? line.slice(0, MAX_BYTES) + "…" : line,
    });
  }

  close(): void {
    this.stream?.end();
  }
}
