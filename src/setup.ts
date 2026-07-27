import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const home = () => process.env.MCPTAP_HOME || os.homedir();

export interface ClientDef {
  id: string;
  name: string;
  file: string;
  format: "json" | "toml";
  /** top-level key holding the server map (JSON formats) */
  key: string;
  /** also scan per-project maps under `projects.*.<key>` (Claude Code) */
  nestedProjects?: boolean;
}

export interface ClientStatus extends ClientDef {
  exists: boolean;
  wrappable: number;
  wrapped: number;
}

export interface ApplyResult {
  client: ClientDef;
  changed: string[];
  skipped: string[];
  backup?: string;
  error?: string;
}

function appSupport(h: string, dir: string): string {
  if (process.platform === "darwin") return path.join(h, "Library", "Application Support", dir);
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(h, "AppData", "Roaming"), dir);
  return path.join(h, ".config", dir);
}

export function clientDefs(): ClientDef[] {
  const h = home();
  const vscodeUser = (dir: string) => path.join(appSupport(h, dir), "User");
  const j = (id: string, name: string, file: string, key = "mcpServers", extra: Partial<ClientDef> = {}): ClientDef =>
    ({ id, name, file, format: "json", key, ...extra });

  return [
    j("claude-code", "Claude Code", path.join(h, ".claude.json"), "mcpServers", { nestedProjects: true }),
    j("claude-desktop", "Claude Desktop", path.join(appSupport(h, "Claude"), "claude_desktop_config.json")),
    { id: "codex", name: "Codex CLI", file: path.join(h, ".codex", "config.toml"), format: "toml", key: "" },
    j("cursor", "Cursor", path.join(h, ".cursor", "mcp.json")),
    j("windsurf", "Windsurf", path.join(h, ".codeium", "windsurf", "mcp_config.json")),
    j("vscode", "VS Code", path.join(vscodeUser("Code"), "mcp.json"), "servers"),
    j("vscode-insiders", "VS Code Insiders", path.join(vscodeUser("Code - Insiders"), "mcp.json"), "servers"),
    j("cline", "Cline", path.join(vscodeUser("Code"), "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json")),
    j("roo", "Roo Code", path.join(vscodeUser("Code"), "globalStorage", "rooveterinaryinc.roo-cline", "settings", "mcp_settings.json")),
    j("gemini", "Gemini CLI", path.join(h, ".gemini", "settings.json")),
    j("lmstudio", "LM Studio", path.join(h, ".lmstudio", "mcp.json")),
    j("zed", "Zed", path.join(h, ".config", "zed", "settings.json"), "context_servers"),
    j("project", "This folder (.mcp.json)", path.resolve(".mcp.json")),
  ];
}

// ---------- entry shapes ----------
// Standard: { command: "npx", args: [...] }
// Zed:      { command: { path: "npx", args: [...] } }

type Entry = Record<string, any>;

function shape(e: Entry): { cmd: string; args: string[]; zed: boolean } | null {
  if (e.url || e.type === "http" || e.type === "sse") return null;
  if (typeof e.command === "string") return { cmd: e.command, args: Array.isArray(e.args) ? e.args : [], zed: false };
  if (e.command && typeof e.command === "object" && typeof e.command.path === "string")
    return { cmd: e.command.path, args: Array.isArray(e.command.args) ? e.command.args : [], zed: true };
  return null;
}

function wrappedShape(e: Entry): { orig: string; rest: string[]; zed: boolean } | null {
  const s = shape(e);
  if (!s) return null;
  if (path.basename(s.cmd).replace(/\.js$/, "") !== "mcptap") return null;
  if (s.args[0] !== "--" || s.args.length < 2) return null;
  return { orig: s.args[1], rest: s.args.slice(2), zed: s.zed };
}

function wrapEntry(e: Entry): void {
  const s = shape(e)!;
  if (s.zed) e.command = { ...e.command, path: "mcptap", args: ["--", s.cmd, ...s.args] };
  else { e.args = ["--", s.cmd, ...s.args]; e.command = "mcptap"; }
}

function unwrapEntry(e: Entry): void {
  const w = wrappedShape(e)!;
  if (w.zed) {
    e.command = { ...e.command, path: w.orig, args: w.rest };
  } else {
    e.command = w.orig;
    if (w.rest.length) e.args = w.rest; else delete e.args;
  }
}

// ---------- JSON configs ----------

function serverMaps(obj: any, def: ClientDef): Record<string, Entry>[] {
  const maps: Record<string, Entry>[] = [];
  if (obj && typeof obj[def.key] === "object" && obj[def.key]) maps.push(obj[def.key]);
  if (def.nestedProjects && obj?.projects && typeof obj.projects === "object") {
    for (const p of Object.values<any>(obj.projects)) {
      if (p && typeof p[def.key] === "object" && p[def.key]) maps.push(p[def.key]);
    }
  }
  return maps;
}

function scanJson(def: ClientDef): { wrappable: number; wrapped: number } {
  try {
    const obj = JSON.parse(fs.readFileSync(def.file, "utf8"));
    let wrappable = 0, wrapped = 0;
    for (const map of serverMaps(obj, def)) {
      for (const e of Object.values(map)) {
        if (wrappedShape(e)) wrapped++;
        else if (shape(e)) wrappable++;
      }
    }
    return { wrappable, wrapped };
  } catch {
    return { wrappable: 0, wrapped: 0 };
  }
}

function applyJson(def: ClientDef, undo: boolean): ApplyResult {
  const res: ApplyResult = { client: def, changed: [], skipped: [] };
  let raw: string;
  try {
    raw = fs.readFileSync(def.file, "utf8");
  } catch (e: any) {
    res.error = `could not read: ${e.message}`;
    return res;
  }
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    res.error = `not plain JSON (comments/JSONC?) — this file needs manual editing`;
    return res;
  }
  for (const map of serverMaps(obj, def)) {
    for (const [name, e] of Object.entries(map)) {
      if (!undo) {
        if (wrappedShape(e)) { res.skipped.push(name); continue; }
        if (!shape(e)) continue;
        wrapEntry(e);
        res.changed.push(name);
      } else {
        if (!wrappedShape(e)) continue;
        unwrapEntry(e);
        res.changed.push(name);
      }
    }
  }
  if (res.changed.length) {
    res.backup = backup(def.file);
    fs.writeFileSync(def.file, JSON.stringify(obj, null, 2) + "\n");
  }
  return res;
}

// ---------- Codex TOML ----------

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

const tomlStr = (s: string) => JSON.stringify(s);

interface TomlSection { name: string; commandLine?: number; argsLine?: number }

function tomlSections(lines: string[]): TomlSection[] {
  const out: TomlSection[] = [];
  let cur: TomlSection | null = null;
  lines.forEach((line, i) => {
    const sec = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sec) {
      cur = null;
      const m = sec[1].match(/^mcp_servers\.([^.]+)$/);
      if (m) { cur = { name: m[1] }; out.push(cur); }
      return;
    }
    if (cur) {
      if (/^\s*command\s*=/.test(line)) cur.commandLine = i;
      if (/^\s*args\s*=/.test(line)) cur.argsLine = i;
    }
  });
  return out;
}

function tomlCmd(line: string): string | undefined {
  return line.match(/=\s*"([^"]*)"/)?.[1] ?? line.match(/=\s*'([^']*)'/)?.[1];
}

function scanToml(def: ClientDef): { wrappable: number; wrapped: number } {
  try {
    const lines = fs.readFileSync(def.file, "utf8").split("\n");
    let wrappable = 0, wrapped = 0;
    for (const s of tomlSections(lines)) {
      if (s.commandLine === undefined) continue;
      const cmd = tomlCmd(lines[s.commandLine]);
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
    res.error = `could not read: ${e.message}`;
    return res;
  }
  const lines = text.split("\n");
  for (const s of tomlSections(lines)) {
    if (s.commandLine === undefined) continue;
    const cmdLine = lines[s.commandLine];
    const indent = cmdLine.match(/^\s*/)?.[0] ?? "";
    const cmd = tomlCmd(cmdLine);
    if (!cmd) { res.skipped.push(s.name); continue; }
    const args = s.argsLine !== undefined ? parseTomlArray(lines[s.argsLine]) : [];
    if (args === null) { res.skipped.push(`${s.name} (complex args, left untouched)`); continue; }

    if (!undo) {
      if (path.basename(cmd) === "mcptap") { res.skipped.push(s.name); continue; }
      lines[s.commandLine] = `${indent}command = "mcptap"`;
      const argsText = `${indent}args = [${["--", cmd, ...args].map(tomlStr).join(", ")}]`;
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
      ? d.format === "json" ? scanJson(d) : scanToml(d)
      : { wrappable: 0, wrapped: 0 };
    return { ...d, exists, ...counts };
  });
}

export function apply(def: ClientDef, undo: boolean): ApplyResult {
  return def.format === "json" ? applyJson(def, undo) : applyToml(def, undo);
}
