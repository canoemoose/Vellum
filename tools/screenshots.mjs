#!/usr/bin/env node
// Homepage screenshots, unattended: launches the release build with its own throwaway WebView2
// profile (your own tabs, recent files and settings are never touched), drives it through
// WebView2's DevTools port, and captures the window with CaptureGraphicsWin2D, which keeps the
// rounded corners and the Windows shadow as real transparency.
//
//   node tools/screenshots.mjs [--only name] [--theme dark|light|both] [--exe path] [--size 1440x900] [--scale 1.5]
//
// --size is the window in CSS pixels; --scale renders the UI at that pixel density (WebView2's
// --force-device-scale-factor), so a 1440x900 window at 1.5 is a 2160x1350 image, sharp on HiDPI
// screens. The window must fit on the screen at that size.
//
// Needs: the release exe (npm run tauri build -- --no-bundle), CaptureGraphicsWin2D on PATH
// (Microsoft Store), and the demonstration drawing set at test-files/fieldwork-festival-drawing-set.pdf
// (made by test-files/drawing-set.mjs). Writes bench-output/screenshots/<shot>-<theme>.png.
// Windows appear on screen while it runs; leave the mouse and keyboard alone until it finishes.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? def : argv[i + 1];
};
const targetDir = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(root, "src-tauri", "target");
const exe = resolve(opt("exe", join(targetDir, "release", "vellum.exe")));
const only = opt("only", null);
const themes = { both: ["dark", "light"], dark: ["dark"], light: ["light"] }[opt("theme", "both")];
const [winW, winH] = opt("size", "1440x900").split("x").map(Number);
const scale = Number(opt("scale", "1.5"));
const outDir = join(root, "bench-output", "screenshots");
const SET = join(root, "test-files", "fieldwork-festival-drawing-set.pdf");
const PORT = 9333;

// Sheet sizes (mm) of the drawing set, by page number.
const SHEETS = { 1: [841, 594], 2: [841, 594], 3: [841, 594], 4: [420, 297] };

// Each shot: steps run in order from a fresh fit-page view of its page, then a capture.
// Points are fractions of the sheet (0..1 across, 0..1 down).
const SHOTS = [
  { name: "hero", page: 2, steps: [] },
  { name: "detail", page: 3, steps: [{ centre: [0.435, 0.29], zoom: 7 }] },
  { name: "site", page: 1, steps: [{ centre: [0.43, 0.45], zoom: 3.5 }] },
  {
    // Scale detection reads page 1 only, so set this sheet's scale the way a user would.
    name: "measure", page: 4, rest: "sidebar", steps: [
      { clickSel: "button.scale" }, { wait: 600 },
      { fill: ["#scale-in", "1:100"] },
      { clickSel: "label.pageonly input" },
      { clickSel: 'button[type="submit"][form="scaleform"]' }, { wait: 600 },
      { key: "d" },
      // Length: click each end, then a third click places the dimension line.
      { click: [0.0774, 0.8434] }, { click: [0.744, 0.8434] }, { click: [0.41, 0.905] },
      { click: [0.101, 0.298] }, { click: [0.101, 0.5] }, { click: [0.06, 0.4] },
      { key: "Escape" }, { key: "Escape" },
    ],
  },
  {
    name: "markup", page: 3, rest: "sidebar", steps: [
      { centre: [0.4346, 0.4428], zoom: 3 },
      { key: "c" },
      { click: [0.413, 0.413] }, { click: [0.454, 0.413] }, { click: [0.454, 0.472] }, { click: [0.413, 0.472] },
      { key: "Enter" },
      { key: "t" },
      { click: [0.475, 0.40] },
      { type: "Move FOH back 5 m: clear of the delay sightline" },
      { key: "Escape" }, { key: "Escape" },
    ],
  },
  { name: "print", page: 2, steps: [{ key: "p", ctrl: true }, { wait: 3000 }], after: [{ key: "Escape" }] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log(s);

// --- Minimal DevTools protocol client over the global WebSocket (Node 22+)
async function connect() {
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
    } catch { /* not up yet */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error("no DevTools target: is WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS honoured?");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message)); else res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("page: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

// --- Input
const VK = { Escape: 27, Enter: 13, PageDown: 34, PageUp: 33, Home: 36, End: 35, Delete: 46 };
async function key(cdp, k, { ctrl = false, shift = false } = {}) {
  const named = k.length > 1;
  const code = named ? VK[k] : k.toUpperCase().charCodeAt(0);
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const base = { key: k, code: named ? k : (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`), windowsVirtualKeyCode: code, modifiers };
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  if (!named && !ctrl) await cdp.send("Input.dispatchKeyEvent", { type: "char", ...base, text: k });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(150);
}
async function mouse(cdp, type, [x, y], button = "none", buttons = 0, clickCount = 0) {
  await cdp.send("Input.dispatchMouseEvent", { type, x, y, button, buttons, clickCount });
}
async function click(cdp, at) {
  await mouse(cdp, "mouseMoved", at);
  await mouse(cdp, "mousePressed", at, "left", 1, 1);
  await mouse(cdp, "mouseReleased", at, "left", 0, 1);
  await sleep(250);
}
async function middleDrag(cdp, from, to) {
  await mouse(cdp, "mouseMoved", from);
  await mouse(cdp, "mousePressed", from, "middle", 4, 1);
  for (let i = 1; i <= 12; i++) {
    await mouse(cdp, "mouseMoved", [from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12], "middle", 4);
    await sleep(16);
  }
  await mouse(cdp, "mouseReleased", to, "middle", 0, 1);
  await sleep(300);
}

// --- Window handling (PowerShell, user32)
function ps(script) {
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("powershell: " + r.stderr);
  return r.stdout.trim();
}
const USER32 = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);'`;
async function mainWindow(pid) {
  for (let i = 0; i < 60; i++) {
    const h = ps(`(Get-Process -Id ${pid}).MainWindowHandle`);
    if (h && h !== "0") return h;
    await sleep(500);
  }
  throw new Error("Vellum's window never appeared");
}
const placeWindow = (hwnd, w, h) => ps(`${USER32}; [W.U]::SetWindowPos([IntPtr]${hwnd}, [IntPtr]::Zero, 80, 60, ${w}, ${h}, 0x0040) | Out-Null`);

function capture(hwnd, file) {
  const tmp = join(outDir, "tmp");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const r = spawnSync("CaptureGraphicsWin2D.exe", [tmp, String(hwnd)], { encoding: "utf8" });
  const png = readdirSync(tmp).find((f) => f.toLowerCase().endsWith(".png"));
  if (!png) throw new Error(`capture failed (exit ${r.status}): ${r.stderr || r.stdout}`);
  rmSync(file, { force: true });
  renameSync(join(tmp, png), file);
  rmSync(tmp, { recursive: true, force: true });
}

// --- View geometry: where a sheet point is on screen, kept in step with pans and zooms.
async function stageRect(cdp) {
  return cdp.evaluate(`(() => { const r = document.querySelector(".stage").getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
}
const zoomPct = (cdp) => cdp.evaluate(`parseFloat(document.querySelector("input.zoom").value)`);
async function fitView(cdp, page) {
  const [x, y, w, h] = await stageRect(cdp);
  const [pw, ph] = SHEETS[page];
  const s = Math.min((w - 32) / pw, (h - 32) / ph); // FIT_PAD 16 each side (engine/viewer.ts)
  return { C: [x + w / 2, y + h / 2], target: [pw / 2, ph / 2], scale: s, pw, ph };
}
const toScreen = (v, [u, w]) => [v.C[0] + (u * v.pw - v.target[0]) * v.scale, v.C[1] + (w * v.ph - v.target[1]) * v.scale];

async function runSteps(cdp, v, steps) {
  for (const st of steps) {
    if (st.key) await key(cdp, st.key, st);
    else if (st.click) await click(cdp, toScreen(v, st.click));
    else if (st.type) { await cdp.send("Input.insertText", { text: st.type }); await sleep(200); }
    else if (st.wait) await sleep(st.wait);
    else if (st.clickSel) {
      const r = await cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(st.clickSel)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
      if (!r) throw new Error("no element " + st.clickSel);
      await click(cdp, r);
    } else if (st.fill) {
      await cdp.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(st.fill[0])}); e.focus(); e.select(); })()`);
      await cdp.send("Input.insertText", { text: st.fill[1] });
      await sleep(200);
    }
    else if (st.centre) {
      // Ctrl+wheel zooms about the pointer, so the target stays under it; then drag it to the middle.
      const at = toScreen(v, st.centre);
      if (st.zoom) {
        const fit = await zoomPct(cdp);
        let cur = fit;
        for (let i = 0; i < 80 && cur < fit * st.zoom * 0.97; i++) {
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at[0], y: at[1], deltaX: 0, deltaY: -100, modifiers: 2 });
          await sleep(80);
          cur = await zoomPct(cdp);
        }
        v.scale *= cur / fit;
      }
      await middleDrag(cdp, at, v.C);
      v.target = [st.centre[0] * v.pw, st.centre[1] * v.ph];
    }
  }
}

async function runTheme(theme) {
  const profile = join(outDir, `profile-${theme}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const env = {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: profile,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --force-device-scale-factor=${scale}`,
    VELLUM_MULTI_INSTANCE: "1",
    VELLUM_DATA_DIR: join(profile, "data"),
  };
  log(`[${theme}] starting Vellum`);
  const proc = spawn(exe, [SET, "--new-instance"], { env, stdio: "ignore" });
  try {
    const cdp = await connect();
    // Wait for the app's own page (the target starts out as about:blank).
    for (let i = 0; i < 60; i++) {
      const ready = await cdp.evaluate(`!location.href.startsWith("about:") && document.readyState === "complete"`).catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    // Settings for clean, repeatable shots, then reload so the app starts with them.
    await cdp.evaluate(`localStorage.setItem("vellum.settings.v1", JSON.stringify({ theme: "${theme}", layoutMode: "single", updateCheck: false, sidebarOpen: true, sidebarTab: "pages" }))`);
    await cdp.send("Page.reload", {});
    await sleep(4000);
    const hwnd = await mainWindow(proc.pid);
    const dpr = await cdp.evaluate("window.devicePixelRatio");
    placeWindow(hwnd, Math.round(winW * dpr), Math.round(winH * dpr));
    await sleep(1500);
    // Single page layout, once: switching layout moves to whichever page is most in view.
    await key(cdp, "1", { ctrl: true, shift: true });
    await sleep(800);
    for (const shot of SHOTS) {
      if (only && shot.name !== only) continue;
      await key(cdp, "Escape");
      await runSteps(cdp, null, [{ fill: ["#pagebox", String(shot.page)] }, { key: "Enter" }, { wait: 800 }]);
      const shown = await cdp.evaluate(`document.querySelector("#pagebox").value`);
      if (shown !== String(shot.page)) throw new Error(`${shot.name}: on page ${shown}, wanted ${shot.page}`);
      await key(cdp, "0", { ctrl: true });
      await sleep(1500);
      const v = await fitView(cdp, shot.page);
      await runSteps(cdp, v, shot.steps);
      // Rest the pointer at the bottom right of the drawing (the status bar shows where it is).
      // (or over the sidebar, so a drawing tool's magnifier doesn't show).
      const [x, y, w, h] = await stageRect(cdp);
      await mouse(cdp, "mouseMoved", shot.rest === "sidebar" ? [x / 2, y + h * 0.6] : [x + w * 0.8, y + h * 0.85]);
      await sleep(shot.settle ?? 3500);
      const file = join(outDir, `${shot.name}-${theme}.png`);
      capture(hwnd, file);
      log(`[${theme}] ${shot.name} -> ${file}`);
      await runSteps(cdp, v, shot.after ?? []);
      // Markups and measurements are left unsaved; undo them so the next shot starts clean.
      for (let i = 0; i < 6; i++) await key(cdp, "z", { ctrl: true });
    }
    cdp.close();
  } finally {
    proc.kill();
    await sleep(1500);
  }
}

if (!existsSync(exe)) { console.error(`No exe at ${exe}. Build it first: npm run tauri build -- --no-bundle`); process.exit(1); }
if (!existsSync(SET)) { console.error(`No drawing set at ${SET}. Make it with test-files/drawing-set.mjs`); process.exit(1); }
mkdirSync(outDir, { recursive: true });
for (const t of themes) await runTheme(t);
log("done");
