import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const home = () => process.env.MCPTAP_HOME || os.homedir();

export interface ClientDef {
  id: string;
  name: string;
  file: string;
  format: "json" | "toml";
}

export interface ClientStatus extends ClientDef {
  exists: boolean;
  wrappable: number; // stdio servers not yet wrapped
  wrapped: number;   // servers already going through mcptap
}

export interface ApplyResult {
  client: ClientDef;
  changed: string[];
  skipped: string[];
  backup?: string;
  error?: string;
}

function claudeDesktopPath(h: string): string {
  if (process.platform === "darwin")
    return path.join(h, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32")
    return path.join(process.env.APPDATA || path.join(h, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(h, ".config", "Claude", "claude_desktop_config.json");
}

export function clientDefs(): ClientDef[] {
  const h = home();
  return [
    { id: "claude-code", name: "Claude Code", file: path.join(h, ".claude.json"), format: "json" },
    { id: "claude-desktop", name: "Claude Desktop", file: claudeDesktopPath(h), format: "json" },
    { id: "codex", name: "Codex CLI", file: path.join(h, ".codex", "config.toml"), format: "toml" },
    { id: "cursor", name: "Cursor", file: path.join(h, ".cursor", "mcp.json"), format: "json" },
    { id: "windsurf", name: "Windsurf", file: path.join(h, ".codeium", "windsurf", "mcp_config.json"), format: "json" },
    { id: "project", name: "This folder (.mcp.json)", file: path.resolve(".mcp.json"), format: "json" },
  ];
}

// ---------- JSON configs (mcpServers object) ----------

type ServerEntry = { command?: string; args?: string[]; url?: string; type?: string };

function isStdio(e: ServerEntry): boolean {
  return typeof e.command === "string" && !e.url && (!e.type || e.type === "stdio");
}
function isWrapped(e: ServerEntry): boolean {
  const base = e.command ? path.basename(e.command) : "";
  return (base === "mcptap" || base === "mcptap.js") && Array.isArray(e.args) && e.args[0] === "--";
}

function scanJson(file: string): { wrappable: number; wrapped: number } {
  try {
    const obj = JSON.parse(fs.readFileSync(file, "utf8"));
    const servers: Record<string, ServerEntry> = obj.mcpServers || {};
    let wrappable = 0, wrapped = 0;
    for (const e of Object.values(servers)) {
      if (isWrapped(e)) wrapped++;
      else if (isStdio(e)) wrappable++;
    }
    return { wrappable, wrapped };
  } catch {
    return { wrappable: 0, wrapped: 0 };
  }
}

function applyJson(def: ClientDef, undo: boolean): ApplyResult {
  const res: ApplyResult = { client: def, changed: [], skipped: [] };
  let obj: any;
  try {
    obj = JSON.parse(fs.readFileSync(def.file, "utf8"));
  } catch (e: any) {
    res.error = `could not parse ${def.file}: ${e.message}`;
    return res;
  }
  const servers: Record<string, ServerEntry> = obj.mcpServers || {};
  for (const [name, e] of Object.entries(servers)) {
    if (!undo) {
      if (isWrapped(e)) { res.skipped.push(name); continue; }
      if (!isStdio(e)) continue;
      e.args = ["--", e.command as string, ...(e.args || [])];
      e.command = "mcptap";
      res.changed.push(name);
    } else {
      if (!isWrapped(e)) continue;
      const a = e.args as string[];
      e.command = a[1];
      const rest = a.slice(2);
      if (rest.length) e.args = rest; else delete e.args;
      res.changed.push(name);
    }
  }
  if (res.changed.length) {
    res.backup = backup(def.file);
    fs.writeFileSync(def.file, JSON.stringify(obj, null, 2) + "\n");
  }
  return res;
}

// ---------- Codex TOML ([mcp_servers.<name>] tables) ----------

function parseTomlArray(line: string): string[] | null {
  const m = line.match(/=\s*(\[.*\])\s*$/);
  if (!m) return null;
  try {
    const arr = JSON.parse(m[1].replace(/'/g, '"'));
    return Array.isArray(arr) && arr.every((x) => typeof x === "string") ? arr : null;
  } catch {
    return null;
  }
}

function tomlStr(s: string): string {
  return JSON.stringify(s); // TOML basic strings are JSON-compatible
}

interface TomlSection { name: string; start: number; end: number; commandLine?: number; argsLine?: number }

function tomlSections(lines: string[]): TomlSection[] {
  const out: TomlSection[] = [];
  let cur: TomlSection | null = null;
  lines.forEach((line, i) => {
    const sec = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) {
      if (cur) cur.end = i;
      cur = null;
      const m = sec[1].match(/^mcp_servers\.(.+)$/);
      if (m) { cur = { name: m[1], start: i, end: lines.length }; out.push(cur); }
      return;
    }
    if (cur) {
      if (/^\s*command\s*=/.test(line)) cur.commandLine = i;
      if (/^\s*args\s*=/.test(line)) cur.argsLine = i;
    }
  });
  return out;
}

function scanToml(file: string): { wrappable: number; wrapped: number } {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let wrappable = 0, wrapped = 0;
    for (const s of tomlSections(lines)) {
      if (s.commandLine === undefined) continue;
      const cmd = lines[s.commandLine].match(/=\s*"([^"]*)"/)?.[1] ?? lines[s.commandLine].match(/=\s*'([^']*)'/)?.[1];
      if (!cmd) continue;
      if (path.basename(cmd) === "mcptap") wrapped++; else wrappable++;
    }
    return { wrappable, wrapped };
  } catch {
    return { wrappable: 0, wrapped: 0 };
  }
}

function applyToml(def: ClientDef, undo: boolean): ApplyResult {
  const res: ApplyResult = { client: def, changed: [], skipped: [] };
  let text: string;
  try {
    text = fs.readFileSync(def.file, "utf8");
  } catch (e: any) {
    res.error = `could not read ${def.file}: ${e.message}`;
    return res;
  }
  const lines = text.split("\n");
  for (const s of tomlSections(lines)) {
    if (s.commandLine === undefined) continue;
    const cmdLine = lines[s.commandLine];
    const indent = cmdLine.match(/^\s*/)?.[0] ?? "";
    const cmd = cmdLine.match(/=\s*"([^"]*)"/)?.[1] ?? cmdLine.match(/=\s*'([^']*)'/)?.[1];
    if (!cmd) { res.skipped.push(s.name); continue; }
    const args = s.argsLine !== undefined ? parseTomlArray(lines[s.argsLine]) : [];
    if (args === null) { res.skipped.push(s.name + " (complex args, left untouched)"); continue; }

    if (!undo) {
      if (path.basename(cmd) === "mcptap") { res.skipped.push(s.name); continue; }
      const newArgs = ["--", cmd, ...args];
      lines[s.commandLine] = `${indent}command = "mcptap"`;
      const argsText = `${indent}args = [${newArgs.map(tomlStr).join(", ")}]`;
      if (s.argsLine !== undefined) lines[s.argsLine] = argsText;
      else lines.splice(s.commandLine + 1, 0, argsText);
      res.changed.push(s.name);
    } else {
      if (path.basename(cmd) !== "mcptap" || !args || args[0] !== "--") continue;
      lines[s.commandLine] = `${indent}command = ${tomlStr(args[1])}`;
      const rest = args.slice(2);
      if (s.argsLine !== undefined) {
        if (rest.length) lines[s.argsLine] = `${indent}args = [${rest.map(tomlStr).join(", ")}]`;
        else lines.splice(s.argsLine, 1);
      }
      res.changed.push(s.name);
    }
  }
  if (res.changed.length) {
    res.backup = backup(def.file);
    fs.writeFileSync(def.file, lines.join("\n"));
  }
  return res;
}

// ---------- shared ----------

function backup(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.mcptap-backup-${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

export function detect(): ClientStatus[] {
  return clientDefs().map((d) => {
    const exists = fs.existsSync(d.file);
    const counts = exists
      ? d.format === "json" ? scanJson(d.file) : scanToml(d.file)
      : { wrappable: 0, wrapped: 0 };
    return { ...d, exists, ...counts };
  });
}

export function apply(def: ClientDef, undo: boolean): ApplyResult {
  return def.format === "json" ? applyJson(def, undo) : applyToml(def, undo);
}
