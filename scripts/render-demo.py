#!/usr/bin/env python3
"""
Render the mcptap README demo GIF.

Draws a macOS-style terminal window and animates a realistic session:
setup wizard -> starter servers -> live dashboard with traffic and a
tool-change alert. Deterministic (no screen recording), so the output is
pixel-clean and reproducible.

Usage: python3 scripts/render-demo.py [out.gif]
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

W, H = 1020, 452
SCALE = 2                      # supersample then downscale for crisp text
PAD_X, PAD_Y = 26, 58
LINE_H = 23
FS = 15
FPS_MS = 70

BG_WIN   = (22, 24, 28)
BG_BAR   = (32, 35, 40)
BORDER   = (48, 52, 59)
INK      = (242, 241, 237)
DIM      = (122, 128, 138)
AMBER    = (232, 163, 61)
GREEN    = (126, 191, 125)
RED      = (226, 108, 108)
CYAN     = (122, 186, 201)
PAGE     = (14, 15, 18)

F  = ImageFont.truetype("/tmp/jbm-400.ttf", FS * SCALE)
FB = ImageFont.truetype("/tmp/jbm-600.ttf", FS * SCALE)
CW = F.getlength("M") / SCALE   # monospace advance

# JetBrains Mono's latin subset lacks box-drawing/block glyphs, so panels and
# bars are drawn as real graphics instead of characters — crisper anyway.
_BOXFONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", FS * SCALE)
GLYPH_FALLBACK = set("─│╭╮╰╯├┤▄█▁▂▃▄▅▆▇●⚠❯➜✓✗→←—")


def seg_font(text, bold):
    """Use the fallback font for glyphs JetBrains Mono's subset is missing."""
    if any(ch in GLYPH_FALLBACK for ch in text):
        return _BOXFONT
    return FB if bold else F


def new_frame():
    img = Image.new("RGB", (W * SCALE, H * SCALE), PAGE)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([8 * SCALE, 8 * SCALE, (W - 8) * SCALE, (H - 8) * SCALE],
                        radius=12 * SCALE, fill=BG_WIN, outline=BORDER, width=SCALE)
    d.rounded_rectangle([8 * SCALE, 8 * SCALE, (W - 8) * SCALE, 46 * SCALE],
                        radius=12 * SCALE, fill=BG_BAR)
    d.rectangle([8 * SCALE, 34 * SCALE, (W - 8) * SCALE, 46 * SCALE], fill=BG_BAR)
    d.line([8 * SCALE, 46 * SCALE, (W - 8) * SCALE, 46 * SCALE], fill=BORDER, width=SCALE)
    for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        cx = (30 + i * 20) * SCALE
        d.ellipse([cx - 6 * SCALE, 21 * SCALE, cx + 6 * SCALE, 33 * SCALE], fill=c)
    t = "mcptap — zsh"
    d.text(((W / 2 - len(t) * CW / 2) * SCALE, 19 * SCALE), t, font=F, fill=DIM)
    return img, d


def draw_lines(d, lines):
    """lines: list of list of (text, color, bold)"""
    for row, segs in enumerate(lines):
        x = PAD_X
        y = PAD_Y + row * LINE_H
        for text, color, bold in segs:
            d.text((x * SCALE, y * SCALE), text, font=seg_font(text, bold), fill=color)
            x += len(text) * CW


def frame(lines, cursor_after=None, panel=None):
    """panel: (start_row, n_rows, width_cols, [separator row offsets]) drawn as
    real graphics so borders are pixel-aligned regardless of glyph widths."""
    img, d = new_frame()
    if panel:
        start, nrows, cols, seps = panel
        x0 = (PAD_X - 8) * SCALE
        y0 = (PAD_Y + start * LINE_H - 8) * SCALE
        x1 = (PAD_X + cols * CW + 8) * SCALE
        y1 = (PAD_Y + (start + nrows) * LINE_H + 2) * SCALE
        d.rounded_rectangle([x0, y0, x1, y1], radius=6 * SCALE, outline=BORDER, width=SCALE)
        for s in seps:
            sy = (PAD_Y + (start + s) * LINE_H - 4) * SCALE
            d.line([x0, sy, x1, sy], fill=BORDER, width=SCALE)
    draw_lines(d, lines)
    if cursor_after is not None:
        row, col = cursor_after
        x = PAD_X + col * CW
        y = PAD_Y + row * LINE_H
        d.rectangle([x * SCALE, (y + 2) * SCALE, (x + CW * 0.85) * SCALE, (y + FS + 4) * SCALE], fill=AMBER)
    return img.resize((W, H), Image.LANCZOS)


frames, durations = [], []


def add(lines, cursor=None, ms=FPS_MS, n=1, panel=None):
    f = frame(lines, cursor, panel)
    for _ in range(n):
        frames.append(f)
        durations.append(ms)


def prompt(cmd_shown):
    return [("➜  ", GREEN, True), ("~ ", CYAN, True), (cmd_shown, INK, False)]


def type_cmd(base, cmd, hold=6):
    """Animate typing `cmd` after existing `base` lines."""
    for i in range(len(cmd) + 1):
        add(base + [prompt(cmd[:i])], cursor=(len(base), 3 + 2 + i), ms=45)
    add(base + [prompt(cmd)], cursor=(len(base), 3 + 2 + len(cmd)), ms=FPS_MS, n=hold)


L = lambda t, c=INK, b=False: [(t, c, b)]
BLANK = []

# ── Scene 1: setup ────────────────────────────────────────────────────────────
s1 = []
type_cmd(s1, "mcptap setup")

logo = [("  [—", INK, True), ("●", AMBER, True), ("—]  ", INK, True), ("mcptap setup", INK, True)]
head = s1 + [prompt("mcptap setup"), BLANK, logo,
             L("  wrap your MCP servers so every tool call gets logged", DIM), BLANK]
add(head, ms=260)

pick = head + [L("Which clients should mcptap monitor?", INK, True),
               L("space toggle · a all · enter confirm · q cancel", DIM)]
rows = [
    ("Claude Code", "(no servers yet — select to install starters)"),
    ("Claude Desktop", "(no servers yet — select to install starters)"),
    ("Codex CLI", "(2 servers)"),
]
for sel in range(3):
    body = []
    for i, (name, hint) in enumerate(rows):
        ptr = ("❯ ", AMBER, True) if i == sel else ("  ", DIM, False)
        box = ("[x] ", GREEN, False) if i <= sel else ("[ ] ", DIM, False)
        body.append([ptr, box, (name + " ", INK, False), (hint, DIM, False)])
    add(pick + body, ms=300)

sel_all = []
for name, hint in rows:
    sel_all.append([("  ", DIM, False), ("[x] ", GREEN, False), (name + " ", INK, False), (hint, DIM, False)])
add(pick + sel_all, ms=420)

# ── Scene 2: provisioning ─────────────────────────────────────────────────────
prov = [prompt("mcptap setup"), BLANK, logo, BLANK,
        [("Claude Code, Claude Desktop", INK, True), (" have no MCP servers yet — installing starters.", INK, False)],
        BLANK]
srv = [("filesystem", "read & write files in a folder you choose"),
       ("memory", "persistent memory across conversations"),
       ("sequential-thinking", "structured step-by-step reasoning")]
for k in range(3):
    body = []
    for i, (n, dsc) in enumerate(srv):
        ptr = ("❯ ", AMBER, True) if i == k else ("  ", DIM, False)
        box = ("[x] ", GREEN, False) if i <= k else ("[ ] ", DIM, False)
        body.append([ptr, box, (n + "  ", INK, False), ("— " + dsc, DIM, False)])
    add(prov + [L("Which servers do you want?", INK, True)] + body, ms=300)

done = prov + [
    [("✓ ", GREEN, True), ("Claude Code", INK, True), (" — added: filesystem, memory, sequential-thinking", INK, False)],
    [("✓ ", GREEN, True), ("Claude Desktop", INK, True), (" — added: filesystem, memory, sequential-thinking", INK, False)],
    [("✓ ", GREEN, True), ("Codex CLI", INK, True), (" — wrapped: github, supabase", INK, False)],
    BLANK,
    [("✓ autopilot on", GREEN, True), (" — new servers get wrapped automatically.", DIM, False)],
]
add(done, ms=1500)

# ── Scene 3: live dashboard ───────────────────────────────────────────────────
type_cmd([], "mcptap watch", hold=4)

BOXW = 70
def box_row(segs):
    return list(segs)

SPARK = "▁▂▃▄▅▆▇█"
feed_pool = [
    ("filesystem", "read_file", True, "3ms"),
    ("memory", "search_nodes", True, "7ms"),
    ("filesystem", "write_file", True, "5ms"),
    ("filesystem", "list_directory", True, "2ms"),
    ("github", "create_issue", False, "812ms"),
    ("memory", "add_observations", True, "4ms"),
    ("filesystem", "read_file", True, "3ms"),
    ("sequential-thinking", "sequentialthinking", True, "11ms"),
]

def dashboard(calls, errors, spark_vals, feed, alert=False):
    """Returns (lines, panel) — panel geometry is computed so borders align."""
    lines, seps = [], []
    lines.append(box_row([("[—", INK, True), ("●", AMBER, True), ("—]  ", INK, True),
                          ("mcptap", INK, True), (" live", DIM, False),
                          (" " * 24, INK, False), ("uptime ", DIM, False), ("1m 12s", INK, True),
                          ("   q quit", DIM, False)]))
    seps.append(len(lines))
    spark = "".join(SPARK[min(7, v)] if v else "·" for v in spark_vals)
    lines.append(box_row([("calls ", DIM, False), (str(calls), INK, True),
                          ("   errors ", DIM, False), (str(errors), RED if errors else INK, True),
                          ("   servers ", DIM, False), ("4", INK, True), ("    ", INK, False),
                          (spark, AMBER, False), ("  90s", DIM, False)]))
    if alert:
        seps.append(len(lines))
        lines.append(box_row([("⚠  tool changes detected", RED, True), ("  possible rug pull — MCP03", DIM, False)]))
        lines.append(box_row([("   ● ", RED, False), ("github", INK, False), ("  ·  ", DIM, False),
                              ("create_issue", INK, False), ("   description-changed", DIM, False)]))
    seps.append(len(lines))
    lines.append(box_row([("server            calls   err   avg      top tool", DIM, False)]))
    servers = [("filesystem", 41, 0, "3ms", 11, "read_file"),
               ("memory", 18, 0, "6ms", 7, "search_nodes"),
               ("github", 9, 1, "790ms", 5, "create_issue")]
    for name, c, e, a, bar, top in servers:
        lines.append(box_row([
            (name.ljust(18), INK, False), (str(c).ljust(8), INK, False),
            (str(e).ljust(6), RED if e else DIM, False), (a.ljust(9), DIM, False),
            ("▄" * bar, AMBER, False), ("▄" * (12 - bar), BORDER, False), ("  " + top, DIM, False)]))
    seps.append(len(lines))
    for srv_, tool, ok, ms in feed:
        lines.append(box_row([("17:04:2" + str(len(tool) % 10) + "  ", DIM, False),
                              ("●", GREEN if ok else RED, False), ("  ", INK, False),
                              (srv_.ljust(21), INK, False), (tool.ljust(23), INK, False), (ms, DIM, False)]))
    return lines, (0, len(lines), BOXW, seps)

calls = 44
spark = [0, 0, 1, 2, 1, 3, 2, 4, 3, 5, 4, 6, 5, 7, 6]
feed = feed_pool[:7]
for step in range(14):
    alert = step >= 9
    lines, panel = dashboard(calls, 1 if step > 3 else 0, spark, feed, alert)
    add(lines, ms=340, panel=panel)
    calls += 3
    spark = spark[1:] + [(step * 2) % 8]
    feed = [feed_pool[(step + i) % len(feed_pool)] for i in range(7)]

lines, panel = dashboard(calls, 1, spark, feed, True)
add(lines, ms=2400, panel=panel)

out = sys.argv[1] if len(sys.argv) > 1 else "assets/demo.gif"
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations,
               loop=0, optimize=True, disposal=2)
print(f"wrote {out} — {len(frames)} frames, {sum(durations)/1000:.1f}s, {os.path.getsize(out)/1024:.0f} KB")
