import { spawn } from "node:child_process";
import path from "node:path";
import { AuditLogger, Direction } from "./logger.js";

/** Derive a readable server name from the wrapped command. */
export function deriveServerName(cmd: string, args: string[]): string {
  if (process.env.MCPTAP_NAME) return process.env.MCPTAP_NAME;
  // Prefer the last package-looking arg (e.g. npx -y @scope/server-foo → server-foo)
  const pkg = [...args].reverse().find((a) => !a.startsWith("-") && !path.isAbsolute(a));
  const base = (pkg || cmd).split("/").pop() || "server";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Spawn the real MCP server, pipe stdio through byte-for-byte,
 * and tap each direction for logging. Returns the child's exit code.
 */
export function runProxy(cmd: string, args: string[]): void {
  const name = deriveServerName(cmd, args);
  const logger = new AuditLogger(name);

  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "inherit"], // stderr passes straight through
    env: process.env,
  });

  child.on("error", (err) => {
    process.stderr.write(`mcptap: failed to start "${cmd}": ${err.message}\n`);
    process.exit(1);
  });

  // Tap: buffers partial lines per direction, parses complete lines for logging only.
  const makeTap = (dir: Direction) => {
    let buf = "";
    return (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          logger.message(dir, JSON.parse(line));
        } catch {
          logger.raw(dir, line);
        }
      }
    };
  };
  const tapIn = makeTap("client->server");
  const tapOut = makeTap("server->client");

  // Passthrough is primary; tapping is a side effect and must never block it.
  process.stdin.on("data", (chunk: Buffer) => {
    child.stdin.write(chunk);
    tapIn(chunk);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    tapOut(chunk);
  });

  process.stdin.on("end", () => child.stdin.end());
  child.on("close", (code) => {
    logger.close();
    process.exit(code ?? 0);
  });

  // Forward termination signals to the child.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => child.kill(sig));
  }
}
