<script lang="ts">
  // The shell: tabs, menus, toolbar, sidebar, canvas, mini map, status bar, dialogs. One
  // Viewer and one canvas serve every tab: switching detaches the current document (it stays
  // open in the backend with its previews) and attaches the next. Shell logic that can be pure
  // lives in src/lib/shell/ with tests; this file wires it to the viewer and the window.
  import { onMount } from "svelte";
  import { getCurrentWindow, availableMonitors, primaryMonitor, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import TitleBar, { type TabView } from "./lib/components/TitleBar.svelte";
  import MenuBar from "./lib/components/MenuBar.svelte";
  import MenuPopup from "./lib/components/MenuPopup.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import MiniMap from "./lib/components/MiniMap.svelte";
  import { type MapMode, rememberDoc } from "./lib/shell/docMemory";
  import { hasCode, userMessage } from "./lib/shell/messages";
  import CanvasScrollbars from "./lib/components/CanvasScrollbars.svelte";
  import StatusBar from "./lib/components/StatusBar.svelte";
  import DebugOverlay from "./lib/components/DebugOverlay.svelte";
  import MarqueeOverlay from "./lib/components/MarqueeOverlay.svelte";
  import PasswordDialog from "./lib/components/dialogs/PasswordDialog.svelte";
  import ScaleDialog from "./lib/components/dialogs/ScaleDialog.svelte";
  import PropertiesDialog from "./lib/components/dialogs/PropertiesDialog.svelte";
  import AboutDialog from "./lib/components/dialogs/AboutDialog.svelte";
  import ShortcutsDialog from "./lib/components/dialogs/ShortcutsDialog.svelte";
  import ExportDialog, { type ExportRequest } from "./lib/components/dialogs/ExportDialog.svelte";
  import PrintDialog from "./lib/components/print/PrintDialog.svelte";
  import appIcon from "../src-tauri/icons/source/vellum.svg";
  import { Viewer, initialUiState, refreshCanvasColour, type DocView, type UiState, type NavMode } from "./lib/engine/viewer";
  import { attachInput } from "./lib/engine/input";
  import { blockedWhileTyping, isWebViewAccelerator } from "./lib/engine/keys";
  import { rendererFor, pdfRenderer } from "./lib/render/createRenderer";
  import type { DocInfo, ScaleCandidate } from "./lib/render/types";
  import type { LayoutMode } from "./lib/view/layout";
  import { PT_TO_CSS, screenToWorld, ZOOM_PRESETS, mapUseful } from "./lib/view/viewMath";
  import { unrotatePoint } from "./lib/view/rotation";
  import type { PageRect, PrintContext } from "./lib/print/context";
  import { loadSettings, saveSettings, type Settings } from "./lib/settings";
  import {
    appendPerfLog, jsHeapMb, launchArgs, memoryStats, onForwardedFiles, pickFiles, pickFolder, revealInExplorer,
    writeBinaryFile, type LaunchArgs,
  } from "./lib/platform";
  import { runBench } from "./lib/perf/bench";
  import {
    activeTab, addTab, closeTab as closeTabModel, cycle, emptyTabs, fileName, findByPath, moveTab, pathKey, truncateMiddle,
    type TabList,
  } from "./lib/shell/tabs";
  import type { Menu, MenuItem } from "./lib/shell/menuNav";
  import { cursorText, pageSizeText } from "./lib/shell/paper";
  import { pickDetectedScale, rememberScale, scaleStatusText, type DocScale } from "./lib/shell/scale";
  import { addRecent, formatZoom } from "./lib/shell/format";
  import { navHint } from "./lib/shell/shortcuts";
  import { resolveTheme, type ThemePref } from "./lib/shell/theme";
  import { placeOnScreen } from "./lib/shell/windowPlacement";
  import { exportPages } from "./lib/shell/exportPages";
  import UpdateNotice from "./lib/components/UpdateNotice.svelte";
  import { Updater, takeHandover, type UpdaterView } from "./lib/updater";

  // ------------------------------------------------------------------ state

  interface Tab {
    id: number;
    path: string;
    title: string;
    kind: "pdf" | "image";
    /** pending: not opened yet (or its open was interrupted by a tab switch). */
    status: "pending" | "loading" | "open" | "error" | "password";
    error: string | null;
    /** The document's state while the tab is in the background. */
    view: DocView | null;
    info: DocInfo | null;
    scale: DocScale | null;
    /** The scale adopted automatically on open, if any. */
    detected: number | null;
    candidates: ScaleCandidate[] | null;
    password: string | null;
    token: number;
    /** The mini map's mode, its size now, and the size to remember (up to the guards). */
    map?: MapMode;
    mapSize?: number;
    mapKeep?: number;
  }

  let host: HTMLDivElement;
  let stageW = $state(1000);

  let stageH = $state(700);
  let canvas: HTMLCanvasElement;
  let viewer = $state.raw<Viewer | null>(null);
  let ui = $state<UiState>(initialUiState());
  let tabs = $state.raw<TabList<Tab>>(emptyTabs<Tab>());
  let settings = $state<Settings>(loadSettings());
  let systemDark = $state(true);
  let debug = $state(false);
  let dropping = $state(false);
  let bench = $state(false);

  type DialogName = "scale" | "properties" | "about" | "shortcuts" | "export" | "print";
  let dialog = $state<DialogName | null>(null);
  let passwordFor = $state<{ tabId: number; error: string | null; busy: boolean } | null>(null);
  let contextMenu = $state<{ items: MenuItem[]; x: number; y: number } | null>(null);
  let marquee = $state<((r: PageRect | null) => void) | null>(null);
  let printOpen = $state(false);
  let printContext = $state.raw<PrintContext | null>(null);
  let exportState = $state<{ progress: { done: number; total: number } | null; result: string | null; ac: AbortController | null }>({
    progress: null,
    result: null,
    ac: null,
  });

  let nextTabId = 1;
  let loadSeq = 0;

  const active = $derived(activeTab(tabs));
  const hasDoc = $derived(!!active && active.status === "open" && ui.docId !== null);
  const theme = $derived(resolveTheme(settings.theme, systemDark));
  const chrome = $derived(!bench);

  // ------------------------------------------------------------------ settings and theme

  function save() {
    saveSettings($state.snapshot(settings) as Settings);
  }

  $effect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    refreshCanvasColour();
    viewer?.requestFrame();
  });

  function setTheme(t: ThemePref) {
    settings.theme = t;
    save();
  }
  function setLayout(m: LayoutMode) {
    viewer?.setLayoutMode(m);
    settings.layoutMode = m;
    save();
  }
  function setColumns(n: number) {
    viewer?.setColumns(n);
    settings.columns = n;
    if (ui.layoutMode !== "columns") setLayout("columns");
    else save();
  }
  /** Navigation mode for the current document; "auto" follows its page size. */
  function setNav(m: NavMode | "auto") {
    viewer?.setNavMode(m);
  }
  function toggleSidebar() {
    settings.sidebarOpen = !settings.sidebarOpen;
    save();
  }

  // ------------------------------------------------------------------ tabs

  function updateTab(id: number, patch: Partial<Tab>) {
    tabs = { ...tabs, tabs: tabs.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
  }
  const tabById = (id: number) => tabs.tabs.find((t) => t.id === id);

  function newTab(path: string): Tab {
    return {
      id: nextTabId++, path, title: fileName(path), kind: rendererFor(path).name === "image" ? "image" : "pdf",
      status: "pending", error: null, view: null, info: null, scale: null, detected: null, candidates: null,
      password: null, token: 0,
    };
  }

  let openChain: Promise<void> = Promise.resolve();

  /**
   * Open files as tabs, one after another; a file that's already open just switches to its
   * tab. Calls are queued, so files dropped or forwarded while another is opening wait their
   * turn instead of interrupting it.
   */
  function openPaths(paths: string[]): Promise<void> {
    openChain = openChain.then(() => openPathsNow(paths)).catch((e) => console.error("open failed", e));
    return openChain;
  }

  async function openPathsNow(paths: string[]) {
    for (const path of paths) {
      const existing = findByPath(tabs, path);
      if (existing) {
        await activate(existing.id);
        continue;
      }
      const r = addTab(tabs, newTab(path));
      tabs = r.list;
      await activate(r.tab.id);
    }
  }

  async function openDialog() {
    const paths = await pickFiles();
    if (paths.length) await openPaths(paths);
  }

  /** Switch to a tab: park the current document, then attach (or open) the target's. */
  async function activate(id: number) {
    const v = viewer;
    const target = tabById(id);
    if (!v || !target) return;
    const cur = active;
    if (cur && cur.id === id && cur.status !== "pending") return;
    if (cur && cur.id !== id) {
      if (cur.status === "open") {
        rememberActive();
        updateTab(cur.id, { view: v.detach() });
      }
      else if (cur.status === "loading") updateTab(cur.id, { status: "pending", token: ++loadSeq }); // its open is abandoned
    }
    tabs = { ...tabs, activeId: id };
    mapHeld = false; // the map may have gone with the old tab before the pointer left it
    const t = tabById(id)!;
    if (t.status === "open" && t.view) {
      v.attach(t.view);
      updateTab(id, { view: null });
      setTitle(t.title);
    } else if (t.status === "pending") {
      await load(id, t.password ?? undefined);
    } else {
      v.close(); // error or password tab: nothing on the canvas
      setTitle(t.title);
    }
  }

  async function load(id: number, password?: string) {
    const v = viewer;
    const t = tabById(id);
    if (!v || !t) return;
    const token = ++loadSeq;
    updateTab(id, { status: "loading", error: null, token });
    setTitle(t.title);
    const mem = settings.docs[pathKey(t.path)];
    v.layoutMode = mem?.layout ?? "continuous"; // a file seen before opens as it was left
    v.columns = mem?.columns ?? settings.columns;
    try {
      await v.open(t.path, password);
    } catch (e) {
      if (tabById(id)?.token !== token) return;
      // By code, never by wording (shell/messages.ts).
      if (hasCode(e, "password_required") || hasCode(e, "wrong_password")) {
        updateTab(id, { status: "password", error: userMessage("[password_required]", "open this file") });
        passwordFor = { tabId: id, error: hasCode(e, "wrong_password") ? userMessage(e, "open this file") : null, busy: false };
      } else {
        console.warn("open failed:", String((e as Error)?.message ?? e));
        updateTab(id, { status: "error", error: userMessage(e, "open this file") });
      }
      return;
    }
    const now = tabById(id);
    if (now?.token !== token || !v.doc || v.currentPath !== t.path) return; // superseded by a tab switch
    const info = v.doc;
    // Back where you were: rotation, navigation mode, zoom and position, mini map. A file
    // opened for the first time keeps the open's own fit and the default mini map.
    if (mem) {
      if (mem.rotation) v.setRotation(mem.rotation);
      if (mem.nav) v.setNavMode(mem.nav);
      if (mem.page < info.numPages) {
        v.setZoom(mem.zoom);
        v.centreOn(mem.page, mem.x, mem.y);
      }
    }
    updateTab(id, {
      status: "open", info, kind: info.kind, password: password ?? null,
      map: mem?.map ?? "auto", mapSize: mem?.mapSize ?? 1, mapKeep: mem?.mapSize ?? 1,
    });
    if (passwordFor?.tabId === id) passwordFor = null;
    settings.recent = addRecent(settings.recent, t.path);
    save();
    detectScale(id, info);
  }

  async function closeTab(id: number) {
    const v = viewer;
    const t = tabById(id);
    if (!v || !t) return;
    if (passwordFor?.tabId === id) passwordFor = null;
    const wasActive = id === tabs.activeId;
    if (wasActive && t.status === "open") rememberActive();
    if (wasActive) v.close(); // also abandons an open in progress
    else if (t.view) v.closeDetached(t.view);
    const after = closeTabModel(tabs, id);
    if (!wasActive) {
      tabs = after;
      return;
    }
    tabs = { tabs: after.tabs, activeId: null };
    if (after.activeId !== null) await activate(after.activeId);
    else setTitle(null);
  }

  async function closeOthers(id: number) {
    for (const t of [...tabs.tabs]) if (t.id !== id) await closeTab(t.id);
    await activate(id);
  }

  // ------------------------------------------------------------------ per-file memory

  /** Remember where the active document is and how it's shown (shell/docMemory.ts). */
  function rememberActive() {
    const v = viewer;
    const t = active;
    if (!v || !t || t.status !== "open" || !v.doc) return;
    const c = v.pagePointAt(v.vw / 2, v.vh / 2);
    const page = c?.page ?? ui.page;
    const size = v.doc.sizes[page];
    settings.docs = rememberDoc(settings.docs, pathKey(t.path), {
      page,
      zoom: ui.zoom,
      x: c?.x ?? (size ? size.w / 2 : 0),
      y: c?.y ?? (size ? size.h / 2 : 0),
      rotation: ui.rotation,
      layout: ui.layoutMode,
      columns: ui.columns,
      nav: ui.navAuto ? null : ui.navMode,
      map: t.map ?? "auto",
      mapSize: t.mapKeep ?? 1,
      t: Date.now(),
    });
    save();
  }

  /** Remember a second after things settle, so a long look round costs one save. */
  let rememberTimer: ReturnType<typeof setTimeout> | undefined;
  function rememberSoon() {
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(rememberActive, 1000);
  }
  $effect(() => {
    // Any change to the view, page, rotation, layout or navigation of the open document.
    // Numbers, not the view object: that's replaced on every pointer move.
    void [ui.page, ui.zoom, ui.viewWorld.x, ui.viewWorld.y, ui.rotation, ui.layoutMode, ui.columns, ui.navMode, ui.navAuto];
    if (hasDoc) rememberSoon();
  });
  $effect(() => {
    // Closing the window inside the second's wait would lose the last move.
    const flush = () => rememberActive();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  });

  function setTitle(name: string | null) {
    getCurrentWindow()
      .setTitle(name ? `${name} - Vellum` : "Vellum")
      .catch(() => {});
  }

  // ------------------------------------------------------------------ drawing scale

  async function detectScale(id: number, info: DocInfo) {
    const t = tabById(id);
    if (!t) return;
    const remembered = settings.scales[pathKey(t.path)];
    if (remembered) updateTab(id, { scale: { ratio: remembered, source: "manual" } });
    const r = rendererFor(t.path);
    if (info.kind !== "pdf" || !r.findScale) {
      updateTab(id, { candidates: [] });
      return;
    }
    try {
      const c = await r.findScale(info.docId, 0);
      const size = info.sizes[0];
      const auto = pickDetectedScale(c, size.w, size.h);
      const cur = tabById(id);
      if (!cur) return;
      updateTab(id, {
        candidates: c,
        detected: auto,
        scale: cur.scale ?? (auto ? { ratio: auto, source: "detected" } : null),
      });
    } catch (e) {
      console.warn("scale detection failed", String(e));
      updateTab(id, { candidates: [] });
    }
  }

  function applyScale(ratio: number | null) {
    const t = active;
    if (!t) return;
    const auto = ratio !== null && ratio === t.detected;
    settings.scales = rememberScale(settings.scales, pathKey(t.path), auto ? null : ratio);
    save();
    updateTab(t.id, { scale: ratio === null ? null : { ratio, source: auto ? "detected" : "manual" } });
    dialog = null;
  }

  // ------------------------------------------------------------------ print

  function viewRect(): PageRect | null {
    const v = viewer;
    if (!v?.doc) return null;
    const page = ui.page;
    const r = v.viewportOnPage(page);
    const s = v.doc.sizes[page];
    if (!r || !s) return null;
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(s.w, r.x + r.w);
    const y1 = Math.min(s.h, r.y + r.h);
    return x1 > x0 && y1 > y0 ? { page, x0, y0, x1, y1 } : null;
  }

  function pickRegion(): Promise<PageRect | null> {
    if (!hasDoc) return Promise.resolve(null);
    return new Promise((res) => {
      marquee = (r) => {
        marquee = null;
        res(r);
      };
    });
  }

  function openPrint() {
    if (!hasDoc || !viewer) return;
    printContext = {
      docs: tabs.tabs
        .filter((t) => t.status === "open" && t.info)
        .map((t) => ({ docId: t.info!.docId, path: t.path, title: t.title, info: t.info!, scale: t.scale?.ratio ?? null })),
      activeDocId: active?.info?.docId ?? null,
      currentPage: ui.page,
      viewRect: viewRect(),
      pickRegion,
      renderer: pdfRenderer(),
      theme,
    };
    printOpen = true;
  }

  // ------------------------------------------------------------------ export

  async function runExport(req: ExportRequest) {
    const t = active;
    if (!t?.info) return;
    const folder = await pickFolder("Export pages to folder");
    if (!folder) return;
    const ac = new AbortController();
    exportState = { progress: { done: 0, total: req.pages.length }, result: null, ac };
    try {
      const r = await exportPages({
        renderer: rendererFor(t.path), docId: t.info.docId, docName: t.title, sizes: t.info.sizes,
        pages: req.pages, dpi: req.dpi, format: req.format, folder, write: writeBinaryFile,
        onProgress: (done, total) => (exportState.progress = { done, total }),
        signal: ac.signal,
      });
      const n = r.written.length;
      let msg = ac.signal.aborted
        ? `Export cancelled after ${n} ${n === 1 ? "page" : "pages"}.`
        : `Exported ${n} ${n === 1 ? "page" : "pages"} to ${folder}.`;
      if (r.reduced.length) msg += ` ${r.reduced.length === 1 ? "One page" : `${r.reduced.length} pages`} ${r.reduced.length === 1 ? "was" : "were"} too large and ${r.reduced.length === 1 ? "was" : "were"} saved at ${Math.min(...r.reduced.map((x) => x[1]))} dpi.`;
      exportState = { progress: null, result: msg, ac: null };
    } catch (e) {
      console.warn("export failed:", String((e as Error)?.message ?? e));
      exportState = { progress: null, result: userMessage(e, "export the pages"), ac: null };
    }
  }

  // ------------------------------------------------------------------ updates

  /**
   * Ask the shell to close before an update installs. Nothing can be lost by closing today,
   * so this only saves where the open document is; an unsaved-changes prompt belongs here
   * (return false to keep Vellum open).
   */
  async function closeForUpdate(): Promise<boolean> {
    rememberActive();
    return true;
  }

  const updater = new Updater({
    onChange: (v) => (update = v),
    readyToClose: closeForUpdate,
    openFiles: () => ({ paths: tabs.tabs.filter((t) => t.status !== "error").map((t) => t.path), active: active?.path ?? null }),
  });
  let update = $state.raw<UpdaterView>(updater.view());

  function setUpdateCheck(on: boolean) {
    settings.updateCheck = on;
    save();
  }

  // ------------------------------------------------------------------ menus

  const docItem = (label: string, action: () => void, shortcut?: string): MenuItem => ({ label, action, shortcut, disabled: !hasDoc });

  const menus = $derived.by((): Menu[] => {
    const v = viewer;
    const recent: MenuItem[] = settings.recent.length
      ? [
          ...settings.recent.map((p) => ({ label: truncateMiddle(p, 64), action: () => openPaths([p]) })),
          { separator: true },
          { label: "Clear recent files", action: () => { settings.recent = []; save(); } },
        ]
      : [{ label: "No recent files", disabled: true }];
    return [
      {
        label: "File",
        items: [
          { label: "Open…", shortcut: "Ctrl+O", action: openDialog },
          { label: "Open recent", submenu: recent },
          { separator: true },
          docItem("Export pages as images…", () => { exportState = { progress: null, result: null, ac: null }; dialog = "export"; }),
          docItem("Show in Explorer", () => active && showInExplorer(active.path)),
          { separator: true },
          docItem("Print…", openPrint, "Ctrl+P"),
          docItem("Document properties", () => (dialog = "properties"), "Ctrl+D"),
          { separator: true },
          { label: "Close tab", shortcut: "Ctrl+W", disabled: !active, action: () => active && closeTab(active.id) },
        ],
      },
      {
        label: "View",
        items: [
          docItem("Zoom in", () => v?.zoomStep(1), "+"),
          docItem("Zoom out", () => v?.zoomStep(-1), "-"),
          docItem("Fit page", () => v?.fit("page", false, true), "Ctrl+0"),
          docItem("Fit width", () => v?.fit("width", false, true), "Ctrl+2"),
          docItem("Actual size", () => v?.actualSize(true), "Ctrl+1"),
          {
            label: "Zoom",
            disabled: !hasDoc,
            submenu: ZOOM_PRESETS.filter((z) => z >= 0.1 && z <= 16).map((z) => ({ label: formatZoom(z), action: () => v?.setZoom(z, undefined, undefined, true) })),
          },
          { separator: true },
          { label: "Single page", shortcut: "Ctrl+Shift+1", radio: true, checked: ui.layoutMode === "single", disabled: !hasDoc, action: () => setLayout("single") },
          { label: "Continuous", shortcut: "Ctrl+Shift+2", radio: true, checked: ui.layoutMode === "continuous", disabled: !hasDoc, action: () => setLayout("continuous") },
          { label: "Columns", shortcut: "Ctrl+Shift+3", radio: true, checked: ui.layoutMode === "columns", disabled: !hasDoc, action: () => setLayout("columns") },
          {
            label: "Columns across",
            disabled: !hasDoc,
            submenu: [2, 3, 4, 5, 6].map((n) => ({ label: String(n), radio: true, checked: ui.columns === n, action: () => setColumns(n) })),
          },
          { separator: true },
          { label: "Automatic navigation (from page size)", radio: true, checked: ui.navAuto, disabled: !hasDoc, action: () => setNav("auto") },
          { label: "CAD navigation", radio: true, checked: !ui.navAuto && ui.navMode === "cad", disabled: !hasDoc, action: () => setNav("cad") },
          { label: "Document navigation", radio: true, checked: !ui.navAuto && ui.navMode === "document", disabled: !hasDoc, action: () => setNav("document") },
          { separator: true },
          { label: "Sidebar", shortcut: "Ctrl+B", checked: settings.sidebarOpen, action: toggleSidebar },
          {
            label: "Mini map",
            disabled: !hasDoc,
            submenu: ([["auto", "Automatic"], ["show", "Show"], ["hide", "Hide"]] as const).map(([m, label]) => ({
              label, radio: true, checked: mapMode === m, action: () => setMapMode(m),
            })),
          },
          { separator: true },
          {
            label: "Theme",
            submenu: (["dark", "light", "system"] as const).map((t) => ({
              label: t === "system" ? "System" : t === "dark" ? "Dark" : "Light", radio: true, checked: settings.theme === t, action: () => setTheme(t),
            })),
          },
          {
            label: "Units",
            submenu: [
              { label: "Millimetres and metres", radio: true, checked: settings.units === "metric", action: () => { settings.units = "metric"; save(); } },
              { label: "Inches and feet", radio: true, checked: settings.units === "imperial", action: () => { settings.units = "imperial"; save(); } },
            ],
          },
          { separator: true },
          { label: "Performance overlay", shortcut: "F12", checked: debug, action: () => (debug = !debug) },
        ],
      },
      {
        label: "Document",
        items: [
          docItem("Rotate view clockwise", () => v?.rotate(1), "R"),
          docItem("Rotate view anticlockwise", () => v?.rotate(-1), "Shift+R"),
          { separator: true },
          docItem("Drawing scale…", openScale),
        ],
      },
      {
        label: "Help",
        items: [
          { label: "Keyboard shortcuts", shortcut: "F1", action: () => (dialog = "shortcuts") },
          { separator: true },
          { label: "Check for updates…", action: () => void updater.check(true) },
          { label: "Check for updates automatically", checked: settings.updateCheck, action: () => setUpdateCheck(!settings.updateCheck) },
          { separator: true },
          { label: "About Vellum", action: () => (dialog = "about") },
        ],
      },
    ];
  });

  // ------------------------------------------------------------------ notices

  /** Something that didn't work, shown in the status bar for a few seconds. */
  let notice = $state<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function notify(msg: string) {
    notice = msg;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), 6000);
  }

  function showInExplorer(path: string) {
    revealInExplorer(path).catch((e) => {
      console.warn("show in explorer failed:", String(e));
      notify(userMessage(e, "show the file in Explorer"));
    });
  }

  function openScale() {
    const t = active;
    if (!hasDoc || !t) return;
    if (t.candidates === null && t.info) detectScale(t.id, t.info);
    dialog = "scale";
  }

  function tabMenu(id: number, x: number, y: number) {
    const t = tabById(id);
    if (!t) return;
    contextMenu = {
      x, y,
      items: [
        { label: "Close tab", shortcut: id === tabs.activeId ? "Ctrl+W" : undefined, action: () => closeTab(id) },
        { label: "Close other tabs", disabled: tabs.tabs.length < 2, action: () => closeOthers(id) },
        { separator: true },
        { label: "Show in Explorer", action: () => showInExplorer(t.path) },
        { label: "Copy path", action: () => navigator.clipboard.writeText(t.path).catch((e) => console.warn(String(e))) },
      ],
    };
  }

  // ------------------------------------------------------------------ keyboard (shell-level; navigation keys live in input.ts)

  /** A modal (a dialog, or the print dialog unless it's hidden for an area pick) owns the keyboard. */
  const modalOpen = $derived(dialog !== null || (printOpen && !marquee));

  // WebView2's own accelerators (reload, find, save page...) don't belong here. Capture phase,
  // so it runs before a dialog or menu can stop the key.
  function guardWebView(e: KeyboardEvent) {
    if (isWebViewAccelerator(e)) e.preventDefault();
  }

  function onKeyDown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (isWebViewAccelerator(e) || marquee || modalOpen || blockedWhileTyping(e)) return;
    // Holding a key must not close every tab, spin the view or flicker the sidebar. Ctrl+Tab
    // may repeat to cycle through tabs.
    if (e.repeat && !(ctrl && e.key === "Tab")) return;
    let handled = true;
    if (ctrl && e.key === "Tab") {
      const t = cycle(tabs, e.shiftKey ? -1 : 1);
      if (t) activate(t.id);
    } else if (ctrl && !e.shiftKey && k === "w") {
      if (active) closeTab(active.id);
    } else if (ctrl && !e.shiftKey && k === "p") {
      openPrint();
    } else if (ctrl && !e.shiftKey && k === "d") {
      if (hasDoc) dialog = "properties";
    } else if (ctrl && !e.shiftKey && k === "b") {
      toggleSidebar();
    } else if (e.key === "F1") {
      dialog = "shortcuts";
    } else if (ctrl && e.shiftKey && !e.altKey && /^Digit[123]$/.test(e.code)) {
      // By the physical key: on a UK keyboard Shift+2 types a quotation mark.
      if (hasDoc) setLayout(e.code === "Digit1" ? "single" : e.code === "Digit2" ? "continuous" : "columns");
    } else if (!ctrl && !e.altKey && !e.shiftKey && k === "n") {
      if (hasDoc) setNav(ui.navMode === "cad" ? "document" : "cad");
    } else if (!ctrl && !e.altKey && k === "r") {
      if (hasDoc) viewer?.rotate(e.shiftKey ? -1 : 1);
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  }

  // ------------------------------------------------------------------ window placement

  async function restoreWindow(win: ReturnType<typeof getCurrentWindow>) {
    const saved = settings.window;
    if (!saved) return;
    try {
      const [mons, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
      // The primary monitor first: a window whose monitor has gone is centred there.
      mons.sort((a, b) => Number(b.name === primary?.name) - Number(a.name === primary?.name));
      const areas = mons.map((m) => ({ x: m.workArea.position.x, y: m.workArea.position.y, w: m.workArea.size.width, h: m.workArea.size.height }));
      const b = placeOnScreen(saved, areas);
      if (b) {
        // Move first, then size: moving onto a monitor with a different scale makes Windows
        // rescale the window, which would undo a size set beforehand.
        await win.setPosition(new PhysicalPosition(b.x, b.y));
        await win.setSize(new PhysicalSize(b.w, b.h));
      }
      if (saved.maximised) await win.maximize();
    } catch (e) {
      console.warn("window restore failed", String(e));
    }
  }

  function trackWindow(win: ReturnType<typeof getCurrentWindow>): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const record = async () => {
      try {
        if (await win.isMinimized()) return;
        const max = await win.isMaximized();
        if (max) {
          // Keep the normal bounds from before maximising, so restoring returns to them.
          let base = settings.window;
          if (!base) {
            const p = await win.outerPosition();
            const s = await win.innerSize();
            base = { x: p.x, y: p.y, w: s.width, h: s.height, maximised: true };
          }
          settings.window = { ...base, maximised: true };
        } else {
          const p = await win.outerPosition();
          const s = await win.innerSize();
          settings.window = { x: p.x, y: p.y, w: s.width, h: s.height, maximised: false };
        }
        save();
      } catch (e) {
        console.warn("window state not saved", String(e));
      }
    };
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(record, 400);
    };
    const uns: (() => void)[] = [];
    win.onMoved(soon).then((u) => uns.push(u)).catch(() => {});
    win.onResized(soon).then((u) => uns.push(u)).catch(() => {});
    return () => {
      if (timer) clearTimeout(timer);
      uns.forEach((u) => u());
    };
  }

  // ------------------------------------------------------------------ start-up

  onMount(() => {
    let detachInput = () => {};
    const cleanups: (() => void)[] = [];
    let ro: ResizeObserver | null = null;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    systemDark = mq.matches;
    const onScheme = () => (systemDark = mq.matches);
    mq.addEventListener("change", onScheme);
    window.addEventListener("keydown", guardWebView, true);
    window.addEventListener("keydown", onKeyDown);

    (async () => {
      const args: LaunchArgs = await launchArgs();
      bench = args.bench;
      const win = getCurrentWindow();
      const v = new Viewer(canvas);
      v.layoutMode = settings.layoutMode;
      v.columns = settings.columns;
      v.onUi = (s) => (ui = s);
      viewer = v;
      ui = v.uiState();
      debug = args.debug || args.bench;

      const measure = () => {
        const r = host.getBoundingClientRect();
        v.resize(r.width, r.height, args.dpr ?? (window.devicePixelRatio || 1));
      };
      ro = new ResizeObserver(measure);
      ro.observe(host);
      measure();
      detachInput = attachInput(host, v, {
        open: openDialog,
        toggleDebug: () => (debug = !debug),
        blocked: () => modalOpen,
        hasDoc: () => hasDoc,
      });

      // Log every settle-to-sharp event while the debug overlay is up.
      v.onSharp = (e) => {
        if (!debug || args.bench) return;
        const st = v.stats();
        memoryStats()
          .then((m) =>
            appendPerfLog(
              ["time", "source", "file", "renderer", "zoom_pct", "settle_to_sharp_ms", "complete", "fps_last_second", "tiles", "cache_mb", "js_heap_mb", "process_mb"],
              [[new Date().toISOString(), "interactive", v.fileName, st.renderer, st.zoom * 100, e.settleToSharpMs, String(e.complete), st.fps, st.tiles, st.cacheMB, jsHeapMb(), m.current.privateWsMb]],
            ),
          )
          .catch(() => {});
      };

      const unDrop = await getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload;
        // The print dialog's manual layout takes Explorer drops itself; don't also open them as tabs.
        if (printOpen) {
          dropping = false;
          return;
        }
        if (p.type === "enter" || p.type === "over") dropping = true;
        else if (p.type === "leave") dropping = false;
        else if (p.type === "drop") {
          dropping = false;
          if (p.paths.length) openPaths(p.paths);
        }
      });
      cleanups.push(unDrop);

      if (!args.bench) {
        await restoreWindow(win);
        cleanups.push(trackWindow(win));
      }

      // Show the window only once the shell has painted, so there's no white flash.
      await win.show();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const shownEpochMs = performance.timeOrigin + performance.now();

      if (args.bench) {
        await runBench(v, args, shownEpochMs);
        return;
      }
      // The launch file first; files forwarded by later launches queue up behind it.
      if (args.file) openPaths([args.file]);
      // The tabs that were open when an update restarted Vellum, once.
      const reopen = await takeHandover();
      if (reopen.length) openPaths(reopen);
      cleanups.push(await onForwardedFiles((paths) => openPaths(paths)));
      // Not awaited: the check never holds up the window or a file opening.
      void updater.autoCheck({ enabled: settings.updateCheck, bench: args.bench, dev: import.meta.env.DEV });
    })().catch((e) => {
      console.error(e);
      ui = { ...ui, error: String(e) };
      getCurrentWindow().show().catch(() => {});
    });

    return () => {
      detachInput();
      cleanups.forEach((f) => f());
      ro?.disconnect();
      mq.removeEventListener("change", onScheme);
      window.removeEventListener("keydown", guardWebView, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  // ------------------------------------------------------------------ derived view data

  /** The hover card's second line: where the tab is (page x of y), or why it didn't open. */
  function tabDetail(t: Tab): string | null {
    if (t.status === "error" || t.status === "password") return t.error;
    if (t.status !== "open" || !t.info || t.info.numPages < 2) return null;
    const page = t.id === tabs.activeId ? ui.page : (t.view?.page ?? 0);
    return `Page ${page + 1} of ${t.info.numPages}`;
  }
  const tabViews = $derived<TabView[]>(
    tabs.tabs.map((t) => ({
      id: t.id, title: t.title, path: t.path, kind: t.kind,
      loading: t.status === "loading", error: t.status === "error" || t.status === "password",
      note: t.info?.meta.note ?? null,
      detail: tabDetail(t),
      snapshot: t.view?.snapshot ?? null,
    })),
  );
  const sizes = $derived(hasDoc && active?.info ? active.info.sizes : []);
  /** The pages the view touches, with their world rects, for the mini map. */
  const mapPages = $derived.by(() => {
    void [ui.layoutMode, ui.rotation, ui.numPages];
    const rects = viewer?.layout.rects ?? [];
    return ui.visiblePages.flatMap((page) => (rects[page] ? [{ page, rect: rects[page]! }] : []));
  });
  /**
   * The mini map shows when it has something to say (mapUseful: a page cut off at the side,
   * or at both top and bottom), once that has held for 300 ms so it can't flicker, and hides
   * as soon as it stops being true.
   */
  // Tall pages count in both navigation modes (Matt). To revisit: CAD only, so documents read
  // at fit width stay clear of the map, would pass ui.navMode === "cad" as the third argument.
  /** The mini map's mode for this file: automatic (when useful), always, or never. */
  const mapMode = $derived<MapMode>(active?.map ?? "auto");
  const mapWanted = $derived(
    hasDoc && mapMode !== "hide" && (mapMode === "show" ? mapPages.length > 0 : mapUseful(ui.viewWorld, mapPages.map((m) => m.rect))),
  );
  function setMapMode(m: MapMode) {
    if (!active) return;
    updateTab(active.id, { map: m });
    rememberSoon();
  }
  /** The pointer is over the map or dragging in it: it stays, whatever the view does. */
  let mapHeld = $state(false);
  let mapShown = $state(false);
  let mapTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const want = mapWanted || mapHeld;
    clearTimeout(mapTimer);
    if (!want) mapShown = false;
    else if (!mapShown) mapTimer = setTimeout(() => (mapShown = true), 300);
  });
  const cursorLabel = $derived.by(() => {
    const c = ui.cursor;
    const s = c ? sizes[c.page] : null;
    if (!c || !s) return "";
    return cursorText(c.x, c.y, s.h, active?.scale?.ratio ?? null, settings.units);
  });
  const pageSizeLabel = $derived.by(() => {
    const s = sizes[ui.page];
    return s ? pageSizeText(s.w, s.h, settings.units) : "";
  });

  /** A viewport point in a page's points, clamped to the page (marquee corners). */
  function pointOn(page: number, sx: number, sy: number) {
    const v = viewer!;
    const r = v.layout.rects[page]!;
    const s = v.doc!.sizes[page];
    const [wx, wy] = screenToWorld(v.view, sx, sy);
    const [x, y] = unrotatePoint(wx - r.x, wy - r.y, s, v.rotation);
    return { x: Math.min(s.w, Math.max(0, x)), y: Math.min(s.h, Math.max(0, y)) };
  }
</script>

<div class="shell">
  <TitleBar
    tabs={tabViews}
    activeId={tabs.activeId}
    onSelect={(id) => activate(id)}
    onClose={(id) => closeTab(id)}
    onMove={(id, to) => (tabs = moveTab(tabs, id, to))}
    onNew={openDialog}
    onContext={tabMenu}
  />
  {#if chrome}
    <MenuBar {menus} disabled={modalOpen} />
    <Toolbar
      page={ui.page}
      numPages={hasDoc ? ui.numPages : 0}
      zoom={ui.zoom}
      {hasDoc}
      sidebarOpen={settings.sidebarOpen}
      onToggleSidebar={toggleSidebar}
      onGotoPage={(i) => viewer?.gotoPage(i)}
      onPrev={() => viewer?.prevPage()}
      onNext={() => viewer?.nextPage()}
      onZoomStep={(d) => viewer?.zoomStep(d)}
      onZoom={(z) => viewer?.setZoom(z, undefined, undefined, true)}
      onFit={(m) => viewer?.fit(m, false, true)}
      onActual={() => viewer?.actualSize(true)}
      navMode={ui.navMode}
      navAuto={ui.navAuto}
      onNavMode={setNav}
      layoutMode={ui.layoutMode}
      columns={ui.columns}
      onLayout={setLayout}
    />
  {/if}

  <div class="body">
    {#if chrome && settings.sidebarOpen}
      <Sidebar
        width={settings.sidebarWidth}
        tab={settings.sidebarTab}
        docId={hasDoc ? ui.docId : null}
        {sizes}
        current={ui.page}
        visible={ui.visiblePages}
        thumbnail={(p, m) => viewer!.thumbnail(p, m)}
        cancelThumbnail={(p, m) => viewer?.cancelThumbnail(p, m)}
        outline={(id) => rendererFor(active?.path ?? ".pdf").outline?.(id) ?? Promise.resolve([])}
        onTab={(t) => {
          settings.sidebarTab = t;
          save();
        }}
        onWidth={(w, done) => {
          settings.sidebarWidth = w;
          if (done) save();
        }}
        onGoto={(p) => viewer?.gotoPage(p)}
        onGotoPoint={(p, y) => viewer?.gotoPagePoint(p, y)}
      />
    {/if}

    {#if chrome && update.notice}
      <UpdateNotice
        state={update.state}
        currentVersion={update.currentVersion}
        onInstall={() => void updater.install()}
        onNotes={() => updater.openNotes().catch((e) => notify(userMessage(e, "open the release notes")))}
        onLater={() => updater.later()}
        onDismiss={() => updater.dismiss()}
      />
    {/if}

    <div class="stage" bind:this={host} bind:clientWidth={stageW} bind:clientHeight={stageH}>
      <canvas bind:this={canvas}></canvas>

      {#if !active && !bench}
        <div class="empty">
          <img src={appIcon} width="40" height="40" alt="" />
          {#if ui.error}
            <p class="err">{ui.error}</p>
          {/if}
          <button type="button" class="btn primary" onclick={openDialog}>Open a file</button>
          <p>or drop PDFs and images here</p>
          {#if settings.recent.length}
            <div class="recent">
              <div class="rh">Recent</div>
              {#each settings.recent.slice(0, 6) as p (p)}
                <button type="button" title={p} onclick={() => openPaths([p])}>{fileName(p)}</button>
              {/each}
            </div>
          {/if}
        </div>
      {:else if active && (active.status === "error" || active.status === "password")}
        <div class="empty">
          <svg width="36" height="36" viewBox="0 0 14 14" aria-hidden="true" class="warn"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1" /><path d="M7 4v3.5M7 9.6v.1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" /></svg>
          <p class="err">Couldn't open <b>{active.title}</b></p>
          <p class="msg selectable">{active.error}</p>
          <div class="row">
            {#if active.status === "password"}
              <button type="button" class="btn primary" onclick={() => (passwordFor = { tabId: active!.id, error: null, busy: false })}>Enter password…</button>
            {:else}
              <button type="button" class="btn" onclick={() => load(active!.id)}>Try again</button>
            {/if}
            <button type="button" class="btn" onclick={() => closeTab(active!.id)}>Close tab</button>
          </div>
        </div>
      {:else if active && (active.status === "loading" || active.status === "pending")}
        <div class="loading">Opening {active.title}…</div>
      {/if}

      {#if chrome && mapMode !== "hide" && hasDoc && viewer && mapShown && mapPages.length}
        <MiniMap
          pages={mapPages}
          rotation={ui.rotation}
          view={ui.viewWorld}
          preview={(p) => viewer!.previewFor(p)}
          docId={ui.docId ?? -1}
          thumbnail={(p, m) => viewer!.thumbnail(p, m)}
          onCentre={(x, y) => viewer?.centreOnWorld(x, y)}
          onHold={(h) => (mapHeld = h)}
          size={active?.mapSize ?? 1}
          {stageW}
          {stageH}
          onSize={(s, done, keep) => {
            if (!active) return;
            updateTab(active.id, done ? { mapSize: s, mapKeep: keep } : { mapSize: s });
            if (done) rememberSoon();
          }}
        />
      {/if}
      {#if chrome && hasDoc && viewer && ui.navMode === "document"}
        <CanvasScrollbars view={ui.viewWorld} bounds={ui.bounds} unitsPerPx={1 / (ui.zoom * PT_TO_CSS)} onPan={(dx, dy) => viewer?.panBy(dx, dy)} />
      {/if}
      {#if marquee}
        <MarqueeOverlay pageAt={(x, y) => viewer?.pagePointAt(x, y) ?? null} {pointOn} onDone={marquee} />
      {/if}
      {#if dropping}
        <div class="drop">Drop to open</div>
      {/if}
      {#if debug && viewer}
        <DebugOverlay {viewer} />
      {/if}
    </div>
  </div>

  {#if chrome}
    <StatusBar
      scaleText={hasDoc ? scaleStatusText(active?.scale ?? null) : null}
      hint={hasDoc ? navHint(ui.navMode) : ""}
      {notice}
      cursor={cursorLabel}
      pageSize={pageSizeLabel}
      onScale={openScale}
    />
  {/if}
</div>

{#if contextMenu}
  <MenuPopup items={contextMenu.items} x={contextMenu.x} y={contextMenu.y} onClose={() => (contextMenu = null)} />
  <div class="ctx-catch" role="presentation" onpointerdown={() => (contextMenu = null)} oncontextmenu={(e) => { e.preventDefault(); contextMenu = null; }}></div>
{/if}

{#if passwordFor}
  {@const pf = passwordFor}
  {@const pt = tabById(pf.tabId)}
  {#if pt}
    <PasswordDialog
      fileName={pt.title}
      error={pf.error}
      busy={pf.busy}
      onSubmit={async (pw) => {
        passwordFor = { ...pf, busy: true };
        await load(pf.tabId, pw);
        if (passwordFor?.tabId === pf.tabId) passwordFor = { ...passwordFor, busy: false };
      }}
      onCancel={() => (passwordFor = null)}
    />
  {/if}
{/if}

{#if dialog === "scale" && active?.info}
  <ScaleDialog fileName={active.title} current={active.scale} candidates={active.candidates} onApply={applyScale} onClose={() => (dialog = null)} />
{:else if dialog === "properties" && active?.info}
  <PropertiesDialog
    path={active.path}
    info={active.info}
    scale={active.scale}
    units={settings.units}
    onClose={() => (dialog = null)}
    onSetScale={openScale}
  />
{:else if dialog === "about"}
  <AboutDialog
    update={update}
    autoCheck={settings.updateCheck}
    onAutoCheck={setUpdateCheck}
    onCheck={() => void updater.check(true)}
    onInstall={() => {
      dialog = null;
      void updater.install();
    }}
    onClose={() => (dialog = null)}
  />
{:else if dialog === "shortcuts"}
  <ShortcutsDialog navMode={ui.navMode} onClose={() => (dialog = null)} />
{:else if dialog === "export" && active?.info}
  <ExportDialog
    fileName={active.title}
    numPages={active.info.numPages}
    currentPage={ui.page}
    progress={exportState.progress}
    result={exportState.result}
    onExport={runExport}
    onCancel={() => exportState.ac?.abort()}
    onClose={() => (dialog = null)}
  />
{/if}

<PrintDialog
  open={printOpen}
  context={printContext}
  onClose={() => {
    printOpen = false;
    printContext = null;
  }}
/>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .body {
    position: relative; /* the update notice sits in its top-right corner */
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .stage {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    background: var(--canvas);
    touch-action: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--tx3);
    padding: 24px;
    text-align: center;
  }
  .empty p {
    margin: 0;
  }
  .err {
    color: var(--tx);
    font-size: 15px;
    max-width: 60ch;
  }
  .msg {
    max-width: 60ch;
    line-height: 1.45;
  }
  .warn {
    color: var(--danger);
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }
  .recent {
    margin-top: 18px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-width: 260px;
    max-width: 420px;
  }
  .rh {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .recent button {
    border: none;
    background: none;
    color: var(--tx2);
    padding: 5px 10px;
    border-radius: 5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recent button:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .loading {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: var(--tx3);
    pointer-events: none;
  }
  .drop {
    position: absolute;
    inset: 12px;
    border: 2px dashed var(--accent);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: var(--tx);
    background: color-mix(in srgb, var(--canvas), transparent 20%);
    pointer-events: none;
    z-index: 30;
  }
  .ctx-catch {
    position: fixed;
    inset: 0;
    z-index: 49;
  }
</style>
