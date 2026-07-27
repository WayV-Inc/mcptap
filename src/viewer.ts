import fs from "node:fs";
import path from "node:path";
import { LOG_DIR, LogEntry, isErrorEntry } from "./logger.js";

const C = {
  dim: "\x1b[2m", reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m",
  yellow: "\x1b[33m", red: "\x1b[31m", bold: "\x1b[1m",
};

function listLogFiles(server?: string): string[] {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((f) => f.endsWith(".jsonl") && (!server || f.startsWith(server)))
    .map((f) => path.join(LOG_DIR, f))
    .sort();
}

function formatEntry(e: LogEntry): string {
  const time = C.dim + e.ts.slice(11, 19) + C.reset;
  const server = C.cyan + e.server + C.reset;
  switch (e.kind) {
    case "request":
      return `${time} ${server} ${C.bold}→ ${e.method}${C.reset} ${C.dim}${short(e.params)}${C.reset}`;
    case "response": {
      const dur = e.durationMs !== undefined ? ` ${C.dim}(${e.durationMs}ms)${C.reset}` : "";
      return isErrorEntry(e)
        ? `${time} ${server} ${C.red}← ${e.method ?? "?"} ERROR${C.reset}${dur} ${C.dim}${short(e.error ?? e.result)}${C.reset}`
        : `${time} ${server} ${C.green}← ${e.method ?? "?"} ok${C.reset}${dur}`;
    }
    case "notification":
      return `${time} ${server} ${C.yellow}· ${e.method}${C.reset}`;
    case "alert": {
      const warn = e.severity === "warn";
      const marker = warn ? `${C.red}${C.bold}⚠${C.reset}` : `${C.yellow}ℹ${C.reset}`;
      const changeColor = warn ? C.red : C.yellow;
      const head = `${time} ${server} ${marker} ${changeColor}${e.change}${C.reset} ${C.dim}${e.tool}${C.reset}`;
      return e.detail ? `${head}\n${C.dim}   ${e.detail}${C.reset}` : head;
    }
    default:
      return `${time} ${server} ${C.dim}raw: ${e.raw}${C.reset}`;
  }
}

function short(v: unknown, max = 120): string {
  if (v === undefined || v === null) return "";
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function readEntries(file: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

/** All entries across log files, oldest first. */
export function readAllEntries(server?: string): LogEntry[] {
  return listLogFiles(server).flatMap(readEntries).sort((a, b) => a.ts.localeCompare(b.ts));
}

export function showLogs(server: string | undefined, tail: number, follow: boolean, json = false): void {
  const files = listLogFiles(server);
  if (files.length === 0) {
    console.log(`No logs found in ${LOG_DIR}${server ? ` for "${server}"` : ""}.`);
    console.log(`Wrap a server first:  mcptap -- npx -y @modelcontextprotocol/server-filesystem /tmp`);
    return;
  }

  const entries = files.flatMap(readEntries)
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-tail);
  for (const e of entries) console.log(json ? JSON.stringify(e) : formatEntry(e));

  if (!follow) return;

  // Follow the newest file by polling its size.
  const newest = files[files.length - 1];
  let offset = fs.statSync(newest).size;
  console.log(`${C.dim}--- following ${path.basename(newest)} (ctrl-c to stop) ---${C.reset}`);
  setInterval(() => {
    try {
      const size = fs.statSync(newest).size;
      if (size <= offset) return;
      const fd = fs.openSync(newest, "r");
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      offset = size;
      for (const line of buf.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try { console.log(json ? line : formatEntry(JSON.parse(line))); } catch { /* skip */ }
      }
    } catch { /* file may rotate */ }
  }, 500);
}
