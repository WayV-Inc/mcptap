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

  const notFound = all.filter((c) => !c.exists);
  if (notFound.length && !opts.yes && ids.length === 0) {
    console.log(`${C.dim}not detected: ${notFound.map((c) => c.name).join(", ")}${C.reset}\n`);
  }
  if (!opts.undo && found.some((c) => c.wrappable + c.wrapped === 0)) {
    console.log(`${C.dim}Tip: some clients have no MCP servers yet — ${C.reset}${C.cyan}mcptap add${C.reset}${C.dim} installs ready-to-use ones (filesystem, memory, …), pre-wrapped.${C.reset}\n`);
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
      const empty = c.wrappable + c.wrapped === 0;
      return {
        label: c.name,
        hint: n > 0
          ? `(${n} server${n === 1 ? "" : "s"}${already})`
          : c.wrapped > 0 ? `(all ${c.wrapped} already wrapped)`
          : `(no servers yet — select to install starters)`,
        checked: n > 0,
        // In wrap mode, empty clients stay selectable: choosing them offers
        // starter-server provisioning after the wrap step.
        disabled: opts.undo ? n === 0 : (n === 0 && !empty),
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

  // Remember the full selection (autopilot should watch provisioned clients too)
  const selectedIds = targets.map((t) => t.id);

  // Selected clients with no servers at all: offer to install starters (interactive only)
  if (!opts.undo && !opts.yes && ids.length === 0 && process.stdin.isTTY) {
    const { ADDABLE, pickServersInteractive, askDirIfNeeded, applyProvision } = await import("./add.js");
    const empty = targets.filter((t) => t.wrappable + t.wrapped === 0);
    const provisionable = empty.filter((t) => ADDABLE.has(t.id));
    for (const t of empty.filter((t) => !ADDABLE.has(t.id)))
      console.log(`${C.dim}${t.name}: no servers, and mcptap can't safely add to this config type — set one up in the app first.${C.reset}`);
    if (provisionable.length) {
      console.log(`\n${C.bold}${provisionable.map((t) => t.name).join(", ")}${C.reset} ${provisionable.length === 1 ? "has" : "have"} no MCP servers yet — installing starters for ${provisionable.length === 1 ? "it" : "them"}.`);
      const cats = await pickServersInteractive();
      if (cats) {
        const dir = await askDirIfNeeded(cats, "");
        applyProvision(provisionable, cats, dir);
      } else {
        console.log(`${C.dim}Skipped starters. Add later with: mcptap add${C.reset}`);
      }
    }
    // remove empty clients from the wrap phase — provisioning already handled them
    targets = targets.filter((t) => t.wrappable + t.wrapped > 0);
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

  // Offer always-on mode after an interactive wrap (macOS only)
  if (!opts.undo && !opts.yes && ids.length === 0 && process.stdin.isTTY && process.platform === "darwin") {
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = (await rl.question(`\nEnable ${C.bold}autopilot${C.reset}? New MCP servers you add later get wrapped automatically. [Y/n] `)).trim().toLowerCase();
    rl.close();
    if (ans === "" || ans === "y" || ans === "yes") {
      const { autopilot } = await import("./autopilot.js");
      await autopilot("on", selectedIds);
    } else {
      console.log(`${C.dim}Skipped. Enable later with: mcptap autopilot on${C.reset}`);
    }
  }
}
