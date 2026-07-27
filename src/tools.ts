import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/**
 * Tool-change detection — OWASP MCP03 (tool poisoning / rug pull).
 *
 * A server can serve benign tool definitions on first contact and later swap in
 * malicious instructions inside a description or schema. The client trusts those
 * strings implicitly: they land in the model's context as trusted content. We
 * fingerprint every tool the first time we see it and flag any later change.
 */

const dir = () => path.join(process.env.MCPTAP_HOME || os.homedir(), ".mcptap", "tools");

export interface ToolAlert {
  severity: "warn" | "info";
  tool: string;
  change: "description-changed" | "schema-changed" | "tool-added" | "tool-removed";
  detail?: string;
}

interface Fingerprint { desc: string; schema: string; seen: string }

function fingerprintOf(tool: Record<string, any>): Fingerprint {
  const h = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex").slice(0, 16);
  return { desc: h(tool.description), schema: h(tool.inputSchema), seen: new Date().toISOString() };
}

function storeFile(server: string): string {
  return path.join(dir(), `${server.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
}

function load(server: string): Record<string, Fingerprint> {
  try {
    return JSON.parse(fs.readFileSync(storeFile(server), "utf8"));
  } catch {
    return {};
  }
}

function save(server: string, data: Record<string, Fingerprint>): void {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(storeFile(server), JSON.stringify(data, null, 2));
  } catch {
    /* never fatal */
  }
}

/**
 * Compare a tools/list result against the stored fingerprints.
 * Returns alerts for anything that changed. First sighting is silent (baseline).
 */
export function checkToolList(server: string, result: unknown): ToolAlert[] {
  const tools = (result as any)?.tools;
  if (!Array.isArray(tools)) return [];

  const known = load(server);
  const isFirstContact = Object.keys(known).length === 0;
  const next: Record<string, Fingerprint> = {};
  const alerts: ToolAlert[] = [];

  for (const t of tools) {
    if (!t || typeof t.name !== "string") continue;
    const fp = fingerprintOf(t);
    next[t.name] = fp;
    const prev = known[t.name];
    if (!prev) {
      if (!isFirstContact) alerts.push({ severity: "info", tool: t.name, change: "tool-added" });
      continue;
    }
    if (prev.desc !== fp.desc)
      alerts.push({
        severity: "warn", tool: t.name, change: "description-changed",
        detail: "tool description changed since first seen — descriptions enter the model's context as trusted text",
      });
    if (prev.schema !== fp.schema)
      alerts.push({
        severity: "warn", tool: t.name, change: "schema-changed",
        detail: "input schema changed since first seen",
      });
  }

  for (const name of Object.keys(known))
    if (!next[name]) alerts.push({ severity: "info", tool: name, change: "tool-removed" });

  save(server, { ...known, ...next });
  return alerts;
}

/** Forget baselines so the next tools/list re-establishes them. */
export function resetBaseline(server?: string): number {
  try {
    const files = fs.readdirSync(dir()).filter((f) => f.endsWith(".json") && (!server || f.startsWith(server)));
    for (const f of files) fs.unlinkSync(path.join(dir(), f));
    return files.length;
  } catch {
    return 0;
  }
}
