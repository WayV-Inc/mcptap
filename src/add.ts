import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clientDefs, selfCmd, ClientDef } from "./setup.js";
import { checkboxes, colors as C } from "./tui.js";

export interface CatalogEntry {
  id: string;
  desc: string;
  pkg: string;
  needsDir?: boolean;
}

export const CATALOG: CatalogEntry[] = [
  { id: "filesystem", desc: "read & write files in a folder you choose", pkg: "@modelcontextprotocol/server-filesystem", needsDir: true },
  { id: "memory", desc: "persistent memory across conversations (knowledge graph)", pkg: "@modelcontextprotocol/server-memory" },
  { id: "sequential-thinking", desc: "structured step-by-step reasoning tool", pkg: "@modelcontextprotocol/server-sequential-thinking" },
  { id: "everything", desc: "demo server exercising every MCP feature — great first test", pkg: "@modelcontextprotocol/server-everything" },
];

// Clients we can add servers to. Zed is excluded (different entry schema semantics).
export const ADDABLE = new Set(["claude-code", "claude-desktop", "codex", "cursor", "windsurf", "vscode", "vscode-insiders", "cline", "roo", "gemini", "lmstudio", "project"]);
// Dedicated MCP config files we may create when absent. App-managed/shared files are never created.
const CREATABLE = new Set(["claude-desktop", "cursor", "windsurf", "vscode", "vscode-insiders", "cline", "roo", "lmstudio", "project"]);

function backup(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.mcptap-backup-${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

/** Entry in wrapped (GUI-safe) form: logged from its very first call. */
function buildCmdline(cat: CatalogEntry, dir: string): string[] {
  return ["npx", "-y", cat.pkg, ...(cat.needsDir ? [dir] : [])];
}

function buildJsonEntry(def: ClientDef, cat: CatalogEntry, dir: string): Record<string, unknown> {
  const { node, script } = selfCmd();
  const entry: Record<string, unknown> = {
    command: node,
    args: [script, "--", ...buildCmdline(cat, dir)],
    env: { MCPTAP_NAME: cat.id },
  };
  if (def.id === "vscode" || def.id === "vscode-insiders") entry.type = "stdio";
  return entry;
}

function addToJson(def: ClientDef, cats: CatalogEntry[], dir: string): { added: string[]; skipped: string[]; backup?: string; error?: string } {
  const res: { added: string[]; skipped: string[]; backup?: string; error?: string } = { added: [], skipped: [] };
  const existed = fs.existsSync(def.file);
  let obj: any = {};
  if (existed) {
    try {
      obj = JSON.parse(fs.readFileSync(def.file, "utf8"));
    } catch {
      res.error = "not plain JSON (comments/JSONC?) — add manually";
      return res;
    }
  }
  if (typeof obj[def.key] !== "object" || obj[def.key] === null) obj[def.key] = {};
  for (const cat of cats) {
    if (obj[def.key][cat.id]) { res.skipped.push(cat.id); continue; }
    obj[def.key][cat.id] = buildJsonEntry(def, cat, dir);
    res.added.push(cat.id);
  }
  if (res.added.length) {
    if (existed) res.backup = backup(def.file);
    else fs.mkdirSync(path.dirname(def.file), { recursive: true });
    fs.writeFileSync(def.file, JSON.stringify(obj, null, 2) + "\n");
  }
  return res;
}

function addToToml(def: ClientDef, cats: CatalogEntry[], dir: string): { added: string[]; skipped: string[]; backup?: string; error?: string } {
  const res: { added: string[]; skipped: string[]; backup?: string; error?: string } = { added: [], skipped: [] };
  let text: string;
  try {
    text = fs.readFileSync(def.file, "utf8");
  } catch (e: any) {
    res.error = `could not read: ${e.message}`;
    return res;
  }
  const { node, script } = selfCmd();
  const blocks: string[] = [];
  for (const cat of cats) {
    if (text.includes(`[mcp_servers.${cat.id}]`)) { res.skipped.push(cat.id); continue; }
    const args = [script, "--", ...buildCmdline(cat, dir)];
    blocks.push([
      `[mcp_servers.${cat.id}]`,
      `command = ${JSON.stringify(node)}`,
      `args = [${args.map((a) => JSON.stringify(a)).join(", ")}]`,
      `env = { "MCPTAP_NAME" = ${JSON.stringify(cat.id)} }`,
    ].join("\n"));
    res.added.push(cat.id);
  }
  if (res.added.length) {
    res.backup = backup(def.file);
    fs.writeFileSync(def.file, text.replace(/\n*$/, "\n\n") + blocks.join("\n\n") + "\n");
  }
  return res;
}

/** Interactive server picker. Returns null on cancel/non-TTY. */
export async function pickServersInteractive(): Promise<CatalogEntry[] | null> {
  const picked = await checkboxes("Which servers do you want?", CATALOG.map((c, i) => ({
    label: c.id, hint: `— ${c.desc}`, checked: i === 0, disabled: false,
  })));
  if (picked === null || picked.length === 0) return null;
  return picked.map((i) => CATALOG[i]);
}

/** Ask for the filesystem server's folder if needed. */
export async function askDirIfNeeded(cats: CatalogEntry[], dir: string): Promise<string> {
  if (!cats.some((c) => c.needsDir) || dir) return dir || os.homedir();
  const fallback = os.homedir();
  if (!process.stdin.isTTY) return fallback;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Folder the filesystem server may access [${fallback}]: `)).trim() || fallback;
  rl.close();
  return answer;
}

/** Apply provisioning to targets and print a summary. Returns count added. */
export function applyProvision(targets: ClientDef[], cats: CatalogEntry[], dir: string): number {
  console.log("");
  let total = 0;
  for (const t of targets) {
    const r = t.format === "json" ? addToJson(t, cats, dir) : addToToml(t, cats, dir);
    if (r.error) { console.log(`${C.red}✗ ${t.name}: ${r.error}${C.reset}`); continue; }
    total += r.added.length;
    if (r.added.length) console.log(`${C.green}✓${C.reset} ${C.bold}${t.name}${C.reset} — added: ${r.added.join(", ")}`);
    else console.log(`${C.dim}· ${t.name} — already present${C.reset}`);
    if (r.skipped.length) console.log(`  ${C.dim}already there: ${r.skipped.join(", ")}${C.reset}`);
    if (r.backup) console.log(`  ${C.dim}backup: ${r.backup}${C.reset}`);
  }
  if (total > 0) {
    console.log(`\n${C.bold}Done.${C.reset} Restart the clients, use them, then ${C.cyan}mcptap logs -f${C.reset} to watch the calls.`);
  }
  return total;
}

export async function runAdd(argv: string[]): Promise<void> {
  const yes = argv.includes("--yes");
  const dirFlag = argv.indexOf("--dir");
  let dir = dirFlag >= 0 ? argv[dirFlag + 1] : "";
  const toFlag = argv.indexOf("--to");
  const toIds = toFlag >= 0 ? (argv[toFlag + 1] || "").split(",").filter(Boolean) : [];
  const positional = argv.filter((a, i) => !a.startsWith("-") && i !== dirFlag + 1 && i !== toFlag + 1);

  console.log(`\n  ${C.bold}[—${C.amber}●${C.reset}${C.bold}—]  mcptap add${C.reset}\n  ${C.dim}install ready-to-use MCP servers, pre-wrapped for logging${C.reset}\n`);

  // -- which servers --
  let cats: CatalogEntry[];
  if (positional.length) {
    const bad = positional.filter((id) => !CATALOG.some((c) => c.id === id));
    if (bad.length) {
      console.log(`${C.red}Unknown server(s): ${bad.join(", ")}${C.reset}\nAvailable: ${CATALOG.map((c) => c.id).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    cats = CATALOG.filter((c) => positional.includes(c.id));
  } else {
    const picked = await pickServersInteractive();
    if (picked === null) {
      console.log(!process.stdin.isTTY
        ? `Not an interactive terminal — name servers and clients: ${C.bold}mcptap add memory --to claude-code --yes${C.reset}`
        : "Cancelled. Nothing was changed.");
      return;
    }
    cats = picked;
  }

  // -- which clients --
  const defs = clientDefs().filter((d) => ADDABLE.has(d.id));
  const eligible = defs.filter((d) => fs.existsSync(d.file) || CREATABLE.has(d.id));
  let targets: ClientDef[];
  if (toIds.length) {
    const bad = toIds.filter((id) => !defs.some((d) => d.id === id));
    if (bad.length) {
      console.log(`${C.red}Unknown client(s): ${bad.join(", ")}${C.reset}\nValid: ${defs.map((d) => d.id).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    targets = eligible.filter((d) => toIds.includes(d.id));
    for (const id of toIds.filter((id) => !targets.some((t) => t.id === id)))
      console.log(`${C.dim}skipping ${id}: config not found and not safely creatable${C.reset}`);
  } else if (yes) {
    targets = eligible.filter((d) => fs.existsSync(d.file) && d.id !== "project");
  } else {
    const picked = await checkboxes("Add to which clients?", eligible.map((d) => ({
      label: d.name,
      hint: fs.existsSync(d.file) ? "(config found)" : "(config will be created)",
      checked: fs.existsSync(d.file) && d.id !== "project",
      disabled: false,
    })));
    if (picked === null || picked.length === 0) {
      console.log("Cancelled. Nothing was changed.");
      return;
    }
    targets = picked.map((i) => eligible[i]);
  }
  if (targets.length === 0) {
    console.log("No target clients. Nothing was changed.");
    return;
  }

  // -- filesystem dir --
  dir = yes && !dir ? (cats.some((c) => c.needsDir) ? os.homedir() : dir) : await askDirIfNeeded(cats, dir);

  applyProvision(targets, cats, dir);
}
