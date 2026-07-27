import fs from "node:fs";
import path from "node:path";
import { LOG_DIR, LogEntry, isErrorEntry } from "./logger.js";

/** Truecolor palette matching the mcptap brand. */
const amber = (s: string) => `\x1b[38;2;232;163;61m${s}\x1b[39m`;
const ink = (s: string) => `\x1b[38;2;242;241;237m${s}\x1b[39m`;
const dim = (s: string) => `\x1b[38;2;120;126;136m${s}\x1b[39m`;
const green = (s: string) => `\x1b[38;2;126;191;125m${s}\x1b[39m`;
const red = (s: string) => `\x1b[38;2;226;108:108m${s}\x1b[39m`.replace(":", ";");
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

const SPARK: string[] = [..."▁▂▃▄▅▆▇█"];
const BUCKET_MS = 3000;
const BUCKETS = 30;

interface ToolAgg { calls: number; errors: number; durations: number[] }
interface ServerAgg {
  calls: number; errors: number; durations: number[]; last: number; tools: Map<string, ToolAgg>;
  client?: string;     // "name version", from the most recent initialize seen
  model?: string;      // last observed model (via sampling/createMessage — rare)
  connStart?: number;  // epoch ms of the most recent initialize handshake
}

function visLen(s: string): string { return s; }
function pad(s: string, n: number): string {
  const len = s.replace(/\x1b\[[0-9;]*m/g, "").length;
  return len >= n ? s : s + " ".repeat(n - len);
}
function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + "…";
}
function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function fmtClient(ci: { name?: string; version?: string }): string | undefined {
  if (!ci.name && !ci.version) return undefined;
  return [ci.name, ci.version].filter(Boolean).join(" ");
}

export function runWatch(serverFilter?: string): void {
  const state = {
    servers: new Map<string, ServerAgg>(),
    alerts: [] as LogEntry[],
    feed: [] as { ts: number; server: string; label: string; ok: boolean; ms?: number }[],
    buckets: new Array<number>(BUCKETS).fill(0) as number[],
    bucketStart: Date.now(),
    total: 0,
    errors: 0,
    started: Date.now(),
  };
  const reqLabel = new Map<string, string>();
  const offsets = new Map<string, number>();
  // Identity/uptime seeded from log backlog, keyed by server, NOT yet promoted into
  // state.servers — a server with zero live traffic this session must stay invisible
  // (an old log file lying around must never resurrect a long-dead connection as a
  // row on the live dashboard). Merged in the moment that server produces real traffic.
  const discovered = new Map<string, { connStart?: number; client?: string }>();

  const label = (e: LogEntry): string =>
    e.method === "tools/call" && (e.params as any)?.name
      ? `${(e.params as any).name}`
      : e.method || "?";

  function getServer(name: string): ServerAgg {
    let s = state.servers.get(name);
    if (!s) { s = { calls: 0, errors: 0, durations: [], last: 0, tools: new Map<string, ToolAgg>() }; state.servers.set(name, s); }
    return s;
  }

  function ingest(e: LogEntry): void {
    if (serverFilter && !e.server.startsWith(serverFilter)) return;

    if (e.kind === "alert") {
      state.alerts.unshift(e);
      state.alerts = state.alerts.slice(0, 4);
      return;
    }
    if (e.kind === "request" && e.id !== undefined && e.id !== null) {
      reqLabel.set(`${e.server} ${e.id}`, label(e));
      if (e.method === "initialize") {
        const srv = getServer(e.server);
        const ts = Date.parse(e.ts);
        if (!Number.isNaN(ts)) srv.connStart = ts; // most recent initialize wins
        if (e.clientInfo) { const c = fmtClient(e.clientInfo); if (c) srv.client = c; }
      }
      return;
    }
    if (e.kind !== "response") return;

    const l = reqLabel.get(`${e.server} ${e.id}`) ?? e.method ?? "?";
    reqLabel.delete(`${e.server} ${e.id}`);
    const isErr = isErrorEntry(e);

    const firstLiveActivity = !state.servers.has(e.server);
    const srv = getServer(e.server);
    if (firstLiveActivity) {
      const seed = discovered.get(e.server);
      if (seed?.connStart) srv.connStart = seed.connStart;
      if (seed?.client) srv.client = seed.client;
    }
    srv.calls++; srv.last = Date.parse(e.ts) || Date.now();
    if (isErr) srv.errors++;
    if (e.model) srv.model = e.model;
    if (typeof e.durationMs === "number") srv.durations.push(e.durationMs);

    const t: ToolAgg = srv.tools.get(l) ?? { calls: 0, errors: 0, durations: [] };
    srv.tools.set(l, t);
    t.calls++; if (isErr) t.errors++;
    if (typeof e.durationMs === "number") t.durations.push(e.durationMs);

    state.total++; if (isErr) state.errors++;
    state.buckets[BUCKETS - 1]++;
    state.feed.unshift({ ts: srv.last, server: e.server, label: l, ok: !isErr, ms: e.durationMs });
    state.feed = state.feed.slice(0, 40);
  }

  /** One-time, bounded backward scan of a newly-discovered log file: find the
   *  most recent initialize request to seed a real connStart/client for the
   *  uptime display, WITHOUT feeding this historical content into live
   *  calls/errors/durations (poll() already skips it for that purpose). Files
   *  are daily-rotated per server, so a single whole-file read is bounded by
   *  construction — this runs once per file, not per poll tick. */
  function seedConnStart(file: string): void {
    let content = "";
    try { content = fs.readFileSync(file, "utf8"); } catch { return; }
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      let e: LogEntry;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.kind === "request" && e.method === "initialize") {
        if (serverFilter && !e.server.startsWith(serverFilter)) return;
        const ts = Date.parse(e.ts);
        const seed: { connStart?: number; client?: string } = {};
        if (!Number.isNaN(ts)) seed.connStart = ts;
        if (e.clientInfo) { const c = fmtClient(e.clientInfo); if (c) seed.client = c; }
        if (seed.connStart !== undefined || seed.client !== undefined) discovered.set(e.server, seed);
        return; // last (most recent) initialize found — done
      }
    }
  }

  function poll(): void {
    let files: string[] = [];
    try {
      files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(LOG_DIR, f));
    } catch { return; }
    for (const file of files) {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { continue; }
      const prev = offsets.get(file);
      if (prev === undefined) { offsets.set(file, size); seedConnStart(file); continue; } // start live, ignore history
      if (size <= prev) { if (size < prev) offsets.set(file, size); continue; }
      try {
        const fd = fs.openSync(file, "r");
        const buf = Buffer.alloc(size - prev);
        fs.readSync(fd, buf, 0, buf.length, prev);
        fs.closeSync(fd);
        offsets.set(file, size);
        for (const line of buf.toString("utf8").split("\n")) {
          if (!line.trim()) continue;
          try { ingest(JSON.parse(line)); } catch { /* partial line */ }
        }
      } catch { /* rotating */ }
    }
  }

  function rotateBuckets(): void {
    const now = Date.now();
    while (now - state.bucketStart >= BUCKET_MS) {
      state.buckets.shift();
      state.buckets.push(0);
      state.bucketStart += BUCKET_MS;
    }
  }

  function avg(a: number[]): number { return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0; }

  function render(): void {
    const W = Math.max(64, Math.min(process.stdout.columns || 92, 110));
    const inner = W - 2;
    const out: string[] = [];
    const line = (s = "") => out.push(`${dim("│")} ${pad(s, inner - 2)} ${dim("│")}`);
    const rule = (l: string, r: string, mid = "─") => out.push(dim(l + mid.repeat(inner) + r));

    const uptStr = fmtUptime(Date.now() - state.started);

    // header
    const title = `${bold(ink("[—"))}${amber("●")}${bold(ink("—]"))}  ${bold(ink("mcptap"))} ${dim("live")}`;
    const right = `${dim("uptime")} ${ink(uptStr)}  ${dim("q quit")}`;
    rule("╭", "╮");
    out.push(`${dim("│")} ${pad(title, inner - 2 - 22)}${pad(right, 22)} ${dim("│")}`);
    rule("├", "┤");

    // counters + sparkline
    const errStr = state.errors > 0 ? red(String(state.errors)) : ink("0");
    const max = Math.max(1, ...state.buckets);
    const spark = state.buckets.map((v) => {
      if (v === 0) return dim("·");
      const idx = Math.min(SPARK.length - 1, Math.floor((v / max) * (SPARK.length - 1)));
      return amber(SPARK[idx]);
    }).join("");
    line(`${dim("calls")} ${bold(ink(String(state.total)))}   ${dim("errors")} ${errStr}   ${dim("servers")} ${ink(String(state.servers.size))}   ${spark} ${dim("90s")}`);

    // alerts
    if (state.alerts.length) {
      rule("├", "┤");
      line(`${bold(red("⚠ tool changes detected"))} ${dim("(possible rug pull — MCP03)")}`);
      for (const a of state.alerts)
        line(`  ${a.severity === "warn" ? red("●") : amber("●")} ${ink(String(a.server))} ${dim("·")} ${ink(String(a.tool))} ${dim(String(a.change))}`);
    }

    // servers
    rule("├", "┤");
    line(dim(`${pad("server", 20)}${pad("calls", 8)}${pad("err", 6)}${pad("avg", 7)}${"top tool"}`));
    const sorted = [...state.servers.entries()].sort((a, b) => b[1].calls - a[1].calls);
    if (sorted.length === 0) {
      line(dim("  waiting for traffic…"));
      line(dim("  use your AI client normally — wrapped servers appear here the moment they're called"));
    } else {
      // Each server is now 2 lines (summary + sub-line). Reserve room below for the
      // feed's own header rule + its 4-row floor + the closing rule.
      const FEED_RESERVE = 8;
      const available = Math.max(2, (process.stdout.rows || 30) - out.length - FEED_RESERVE);
      const maxServers = Math.max(1, Math.floor(available / 2));
      const shown = sorted.slice(0, maxServers);
      for (const [name, s] of shown) {
        const top = [...s.tools.entries()].sort((a, b) => b[1].calls - a[1].calls)[0];
        const barW = 14;
        const filled = top ? Math.max(1, Math.round((top[1].calls / Math.max(1, s.calls)) * barW)) : 0;
        const bar = amber("▄".repeat(filled)) + dim("▄".repeat(barW - filled));
        line(
          pad(ink(trunc(name, 18)), 20) +
          pad(ink(String(s.calls)), 8) +
          pad(s.errors ? red(String(s.errors)) : dim("0"), 6) +
          pad(dim(`${avg(s.durations)}ms`), 7) +
          `${bar} ${dim(trunc(top ? top[0] : "—", 16))}`
        );
        const parts: string[] = [];
        if (s.connStart) parts.push(`up ${fmtUptime(Date.now() - s.connStart)}`);
        if (s.client) parts.push(`client: ${trunc(s.client, 24)}`);
        if (s.model) parts.push(`model: ${trunc(s.model, 20)} (via sampling)`);
        const sub = parts.length ? `  ${parts.join(" · ")}` : "  connection info unknown (predates this version, or reconnect not yet seen)";
        line(dim(trunc(sub, inner - 2)));
      }
      if (sorted.length > shown.length) {
        line(dim(`  +${sorted.length - shown.length} more — see mcptap stats`));
      }
    }

    // feed
    rule("├", "┤");
    const rows = Math.max(4, Math.min(12, (process.stdout.rows || 30) - out.length - 4));
    for (const f of state.feed.slice(0, rows)) {
      const t = new Date(f.ts).toISOString().slice(11, 19);
      line(`${dim(t)} ${f.ok ? green("●") : red("●")} ${pad(ink(trunc(f.server, 16)), 18)}${pad(ink(trunc(f.label, 28)), 30)}${dim(f.ms !== undefined ? `${f.ms}ms` : "")}`);
    }
    if (state.feed.length === 0) line(dim("  no calls yet"));
    rule("╰", "╯");

    process.stdout.write(`\x1b[H\x1b[2J${out.join("\n")}\n`);
  }

  // Make sure the log dir exists so the first poll doesn't no-op forever.
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

  // alt screen + cursor hide
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    process.exit(0);
  };
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    // Ignore anything already buffered (leftover keystrokes from the shell or a
    // previous prompt would otherwise quit the dashboard the instant it opens).
    let accepting = false;
    setTimeout(() => { process.stdin.read?.(); accepting = true; }, 250);
    process.stdin.on("data", (b) => {
      if (!accepting) return;
      const s = b.toString();
      // Only explicit quit keys. A bare ESC is excluded: arrow keys arrive as
      // escape sequences that can split across chunks and look like a lone ESC.
      if (s === "q" || s === "Q" || s === "\x03" || s === "\x04") cleanup();
    });
  }
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  // Never strand the user in the alternate screen if something goes wrong.
  process.on("uncaughtException", (err) => {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    console.error("mcptap watch error:", err?.message || err);
    process.exit(1);
  });

  poll(); render();
  setInterval(() => { poll(); rotateBuckets(); render(); }, 400);
}
