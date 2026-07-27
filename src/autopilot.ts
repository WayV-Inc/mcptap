import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clientDefs } from "./setup.js";
import { colors as C } from "./tui.js";

const LABEL = "com.wayv-software.mcptap.autopilot";

const plistPath = () =>
  path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const logPath = () => path.join(os.homedir(), ".mcptap", "autopilot.log");

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Pure plist renderer (exported for tests). */
export function renderPlist(nodeBin: string, script: string, ids: string[], watchPaths: string[], log: string): string {
  const args = [nodeBin, script, "setup", ...ids, "--yes"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join("\n")}
  </array>
  <key>WatchPaths</key>
  <array>
${watchPaths.map((p) => `    <string>${esc(p)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`;
}

function launchctl(...args: string[]): void {
  try {
    execFileSync("launchctl", args, { stdio: "ignore" });
  } catch {
    /* unload of a non-loaded job etc. — fine */
  }
}

export async function autopilot(cmd: string, ids: string[]): Promise<void> {
  if (process.platform !== "darwin" && cmd !== "status") {
    console.log("autopilot is macOS-only for now (uses launchd). On Linux, a systemd path unit doing `mcptap setup --yes` achieves the same — see docs/cli-reference.md.");
    process.exitCode = 1;
    return;
  }

  if (cmd === "on") {
    const defs = clientDefs().filter((d) => d.id !== "project"); // cwd-relative, meaningless in a daemon
    ids = ids.filter((id) => id !== "project");
    const selected = ids.length ? defs.filter((d) => ids.includes(d.id)) : defs;
    if (ids.length && selected.length !== ids.length) {
      const bad = ids.filter((id) => !defs.some((d) => d.id === id));
      console.log(`${C.red}Unknown client id(s): ${bad.join(", ")}${C.reset}`);
      process.exitCode = 1;
      return;
    }
    const script = fileURLToPath(new URL("./index.js", import.meta.url));
    fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.writeFileSync(
      plistPath(),
      renderPlist(process.execPath, script, selected.map((d) => d.id), selected.map((d) => d.file), logPath())
    );
    launchctl("unload", plistPath());
    launchctl("load", plistPath());
    console.log(`${C.green}✓ autopilot on${C.reset} — watching ${selected.length} client config${selected.length === 1 ? "" : "s"}.`);
    console.log(`${C.dim}New MCP servers get wrapped automatically the moment they appear in a config.`);
    console.log(`Log: ${logPath()}   Turn off: mcptap autopilot off${C.reset}`);
    return;
  }

  if (cmd === "off") {
    launchctl("unload", plistPath());
    try { fs.unlinkSync(plistPath()); } catch { /* not installed */ }
    console.log(`${C.green}✓ autopilot off${C.reset} — existing wraps are untouched (use setup --undo to remove them).`);
    return;
  }

  if (cmd === "status") {
    const installed = fs.existsSync(plistPath());
    console.log(installed ? `autopilot: ${C.green}on${C.reset} (${plistPath()})` : "autopilot: off");
    if (installed && fs.existsSync(logPath())) {
      const tail = fs.readFileSync(logPath(), "utf8").trim().split("\n").slice(-5);
      if (tail.length && tail[0]) console.log(`${C.dim}recent activity:\n  ${tail.join("\n  ")}${C.reset}`);
    }
    return;
  }

  console.log(`Usage: mcptap autopilot on [clients...] | off | status`);
  process.exitCode = 1;
}
