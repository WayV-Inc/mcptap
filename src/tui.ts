import readline from "node:readline";

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  cyan: "\x1b[36m", amber: "\x1b[33m", green: "\x1b[32m", red: "\x1b[31m",
};

export interface ChoiceItem {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
}

/**
 * Minimal dependency-free checkbox prompt.
 * Arrows/j/k move, space toggles, a toggles all, enter confirms, q/esc cancels.
 * Returns selected indexes, or null if not a TTY / cancelled.
 */
export function checkboxes(title: string, items: ChoiceItem[]): Promise<number[] | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(null);

  return new Promise((resolve) => {
    let cursor = items.findIndex((i) => !i.disabled);
    if (cursor < 0) cursor = 0;
    let rendered = 0;

    const render = () => {
      if (rendered) process.stdout.write(`\x1b[${rendered}A`);
      const lines: string[] = [];
      lines.push(`${C.bold}${title}${C.reset}`);
      lines.push(`${C.dim}space toggle · a all · n none · enter confirm · q cancel${C.reset}`);
      items.forEach((it, i) => {
        const ptr = i === cursor ? `${C.amber}❯${C.reset}` : " ";
        const box = it.disabled
          ? `${C.dim}[ ]${C.reset}`
          : it.checked ? `${C.green}[x]${C.reset}` : "[ ]";
        const label = it.disabled ? `${C.dim}${it.label}${C.reset}` : it.label;
        lines.push(`${ptr} ${box} ${label} ${C.dim}${it.hint}${C.reset}`);
      });
      rendered = lines.length;
      process.stdout.write(lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n");
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const done = (result: number[] | null) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("keypress", onKey);
      resolve(result);
    };

    const move = (delta: number) => {
      const n = items.length;
      for (let step = 0; step < n; step++) {
        cursor = (cursor + delta + n) % n;
        if (!items[cursor].disabled) break;
      }
    };

    const onKey = (_: string, key: readline.Key) => {
      if (!key) return;
      if (key.name === "up" || key.name === "k") move(-1);
      else if (key.name === "down" || key.name === "j") move(1);
      else if (key.name === "space") { if (!items[cursor].disabled) items[cursor].checked = !items[cursor].checked; }
      // "a" always selects all and "n" always clears — a toggle here is a trap:
      // pressing "a" when everything is already checked would silently deselect.
      else if (key.name === "a") items.forEach((i) => { if (!i.disabled) i.checked = true; });
      else if (key.name === "n") items.forEach((i) => { if (!i.disabled) i.checked = false; });
      else if (key.name === "return") { render(); return done(items.map((it, i) => (it.checked && !it.disabled ? i : -1)).filter((i) => i >= 0)); }
      else if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) { render(); return done(null); }
      render();
    };

    process.stdin.on("keypress", onKey);
    render();
  });
}

export const colors = C;
