import { detect, apply, ClientStatus, ApplyResult } from "./setup.js";
import { checkboxes, colors as C } from "./tui.js";

const logo = `
  ${C.bold}[—${C.amber}●${C.reset}${C.bold}—]  mcptap setup${C.reset}
  ${C.dim}wrap your MCP servers so every tool call gets logged${C.reset}
`;

export async function runSetup(ids: string[], opts: { undo: boolean; yes: boolean }): Promise<void> {
  console.log(logo);
  const all = detect();
  const found = all.filter((c) => c.exists);

  if (found.length === 0) {
    console.log(`No MCP client configs found. Looked for:`);
    for (const c of all) console.log(`  ${C.dim}${c.name.padEnd(24)} ${c.file}${C.reset}`);
    process.exitCode = 1;
    return;
  }

  let targets: ClientStatus[];

  if (ids.length > 0) {
    const bad = ids.filter((id) => !all.some((c) => c.id === id));
    if (bad.length) {
      console.log(`${C.red}Unknown client id(s): ${bad.join(", ")}${C.reset}`);
      console.log(`Valid ids: ${all.map((c) => c.id).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    targets = found.filter((c) => ids.includes(c.id));
    const missing = ids.filter((id) => !targets.some((c) => c.id === id));
    for (const id of missing) console.log(`${C.dim}skipping ${id}: config file not found${C.reset}`);
  } else if (opts.yes) {
    targets = found.filter((c) => (opts.undo ? c.wrapped > 0 : c.wrappable > 0));
  } else {
    const items = found.map((c) => {
      const n = opts.undo ? c.wrapped : c.wrappable;
      const already = !opts.undo && c.wrapped > 0 ? `, ${c.wrapped} already wrapped` : "";
      return {
        label: c.name,
        hint: n > 0 ? `(${n} server${n === 1 ? "" : "s"}${already})` : `(nothing to ${opts.undo ? "unwrap" : "wrap"})`,
        checked: n > 0,
        disabled: n === 0,
      };
    });
    const picked = await checkboxes(
      opts.undo ? "Unwrap mcptap from which clients?" : "Which clients should mcptap monitor?",
      items
    );
    if (picked === null) {
      if (!process.stdin.isTTY) {
        console.log(`Not an interactive terminal — rerun with ${C.bold}--yes${C.reset} (all clients) or name clients: ${C.bold}mcptap setup claude-code codex --yes${C.reset}`);
      } else {
        console.log("Cancelled. Nothing was changed.");
      }
      return;
    }
    targets = picked.map((i) => found[i]);
  }

  if (targets.length === 0) {
    console.log(`Nothing to do — every detected client is ${opts.undo ? "already unwrapped" : "already wrapped"}.`);
    return;
  }

  console.log("");
  const results: ApplyResult[] = targets.map((t) => apply(t, opts.undo));
  let totalChanged = 0;

  for (const r of results) {
    if (r.error) {
      console.log(`${C.red}✗ ${r.client.name}: ${r.error}${C.reset}`);
      continue;
    }
    totalChanged += r.changed.length;
    const verb = opts.undo ? "unwrapped" : "wrapped";
    if (r.changed.length)
      console.log(`${C.green}✓${C.reset} ${C.bold}${r.client.name}${C.reset} — ${verb}: ${r.changed.join(", ")}`);
    else
      console.log(`${C.dim}· ${r.client.name} — nothing to change${C.reset}`);
    if (r.skipped.length)
      console.log(`  ${C.dim}skipped: ${r.skipped.join(", ")}${C.reset}`);
    if (r.backup)
      console.log(`  ${C.dim}backup: ${r.backup}${C.reset}`);
  }

  if (totalChanged > 0) {
    console.log("");
    if (opts.undo) {
      console.log(`${C.bold}Done.${C.reset} Restart your clients to go back to direct connections.`);
    } else {
      console.log(`${C.bold}Done.${C.reset} Restart your clients, use them normally, then:`);
      console.log(`  ${C.cyan}mcptap logs -f${C.reset}   ${C.dim}watch every tool call live${C.reset}`);
      console.log(`  ${C.dim}undo anytime: mcptap setup --undo${C.reset}`);
    }
  }
}
