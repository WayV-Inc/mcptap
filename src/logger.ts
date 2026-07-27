import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkToolList } from "./tools.js";

const MAX_BYTES = Number(process.env.MCPTAP_MAX_BYTES || 4096);
const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|credential/i;

export const LOG_DIR = path.join(os.homedir(), ".mcptap", "logs");

export type Direction = "client->server" | "server->client";

export interface LogEntry {
  ts: string;
  server: string;
  dir: Direction;
  kind: "request" | "response" | "notification" | "raw" | "alert";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  durationMs?: number;
  raw?: string;
  /** alert fields */
  severity?: "warn" | "info";
  tool?: string;
  change?: string;
  detail?: string;
  /** Captured once per handshake, from the initialize request (client->server). */
  clientInfo?: { name?: string; version?: string };
  /** Captured when a response carries a model id — only happens for the rare
   *  sampling/createMessage round trip; absent for the vast majority of servers. */
  model?: string;
}

/**
 * True when a JSON-RPC response or MCP tool result signals failure.
 * Tool-call failures are conventionally carried as `result.isError: true`
 * (MCP spec), not a JSON-RPC-level `error` object — both must count.
 */
export function isErrorEntry(e: Pick<LogEntry, "error" | "result">): boolean {
  return e.error !== undefined || (e.result as any)?.isError === true;
}

/** Extract {name, version} from an initialize request's params.clientInfo, if present. */
function extractClientInfo(params: unknown): { name?: string; version?: string } | undefined {
  const ci = (params as any)?.clientInfo;
  if (!ci || typeof ci !== "object") return undefined;
  const name = typeof ci.name === "string" ? (sanitize(ci.name) as string) : undefined;
  const version = typeof ci.version === "string" ? (sanitize(ci.version) as string) : undefined;
  return name !== undefined || version !== undefined ? { name, version } : undefined;
}

/** Extract result.model, but only for the one method that actually carries it. */
function extractModel(method: string | undefined, result: unknown): string | undefined {
  if (method !== "sampling/createMessage") return undefined;
  const m = (result as any)?.model;
  return typeof m === "string" ? (sanitize(m) as string) : undefined;
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
      // initialize is always client->server; clientInfo, if present, is a one-time identity signal.
      const clientInfo = method === "initialize" ? extractClientInfo(msg.params) : undefined;
      this.write({ ts, server: this.server, dir, kind: "request", id, method,
        params: sanitize(msg.params), ...(clientInfo ? { clientInfo } : {}) });
    } else if (method !== undefined) {
      // notification
      this.write({ ts, server: this.server, dir, kind: "notification", method,
        params: sanitize(msg.params) });
    } else if (id !== undefined) {
      // response
      const req = this.pending.get(id);
      if (req) this.pending.delete(id);
      const model = msg.error === undefined ? extractModel(req?.method, msg.result) : undefined;
      this.write({
        ts, server: this.server, dir, kind: "response", id,
        method: req?.method,
        durationMs: req ? Date.now() - req.at : undefined,
        ...(model !== undefined ? { model } : {}),
        ...(msg.error !== undefined
          ? { error: sanitize(msg.error) }
          : { result: sanitize(msg.result) }),
      });
      // Tool-change detection: fingerprint tool definitions on every tools/list
      if (req?.method === "tools/list" && msg.result !== undefined) {
        try {
          for (const a of checkToolList(this.server, msg.result))
            this.write({ ts: new Date().toISOString(), server: this.server, dir, kind: "alert", ...a });
        } catch { /* never fatal */ }
      }
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
