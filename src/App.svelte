<script lang="ts">
  // The shell: tabs, menus, toolbar, sidebar, canvas, mini map, status bar, dialogs. One
  // Viewer and one canvas serve every tab: switching detaches the current document (it stays
  // open in the backend with its previews) and attaches the next. Shell logic that can be pure
  // lives in src/lib/shell/ with tests; this file wires it to the viewer and the window.
  import { onMount, untrack } from "svelte";
  import { getCurrentWindow, availableMonitors, primaryMonitor, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import TitleBar, { type TabView } from "./lib/components/TitleBar.svelte";
  import MenuBar from "./lib/components/MenuBar.svelte";
  import MenuPopup from "./lib/components/MenuPopup.svelte";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import SearchField from "./lib/components/SearchField.svelte";
  import ToolPalette from "./lib/components/ToolPalette.svelte";
  import PropertiesStrip from "./lib/components/PropertiesStrip.svelte";
  import TextEditor from "./lib/components/TextEditor.svelte";
  import ChoiceDialog, { type Choice } from "./lib/components/dialogs/ChoiceDialog.svelte";
  import { type ClipRead, MarkupTool, type Tool } from "./lib/engine/markupTool";
  import { labelOf } from "./lib/markup/kinds";
  import { toolById, toolForKey } from "./lib/markup/tools";
  import { barFor, subjectOf, subjectOfTool } from "./lib/markup/bar";
  import { MarkupDoc } from "./lib/engine/markupDoc";
  import { confirm as confirmSave, styleFor, textFor, sidesFor } from "./lib/markup/prefs";
  import type { Frame } from "./lib/markup/pdf";
  import { TEXT_PAD } from "./lib/markup/ops";
  import type { Markup, Style, TextStyle } from "./lib/markup/types";
  import { type FileInfo, type Stamp, copyName, recoveryKey, saveConfirmation, unlockWarnings, unsavedMessage } from "./lib/shell/save";
  import { type AnnotRead, fromFile, stampHashes, withStampImages } from "./lib/markup/fileAnnots"; // Existing annotations
  import EditLock from "./lib/components/EditLock.svelte"; // Existing annotations
  import type { Dock } from "./lib/shell/dock";
  import { invoke } from "@tauri-apps/api/core";
  import type { SearchView } from "./lib/components/SearchResults.svelte";
  import { TextTool } from "./lib/engine/textTool";
  import { SearchController } from "./lib/engine/search";
  import { linkLabel } from "./lib/text/links";
  import MiniMap from "./lib/components/MiniMap.svelte";
  import { type MapMode, rememberDoc } from "./lib/shell/docMemory";
  import { hasCode, userMessage } from "./lib/shell/messages";
  import CanvasScrollbars from "./lib/components/CanvasScrollbars.svelte";
  import StatusBar from "./lib/components/StatusBar.svelte";
  import DebugOverlay from "./lib/components/DebugOverlay.svelte";
  import MarqueeOverlay from "./lib/components/MarqueeOverlay.svelte";
  // Measuring
  import CalibrateDialog from "./lib/components/dialogs/CalibrateDialog.svelte";
  import Loupe from "./lib/components/Loupe.svelte";
  import { type MeasureFormat, type PageMeasure, setMeasureSource } from "./lib/markup/measure";
  import { drawingLine, isMeasurement, measurementLine, resizeLabels, reformat, resolveAuto, revalue } from "./lib/markup/measurements";
  // Dimensions (stage 5)
  import { type Measurement, hasEnds, relook } from "./lib/markup/measurements";
  import { type DimensionLook, setDimensionLook } from "./lib/markup/dimension";
  import { calibratePaperMm } from "./lib/markup/kinds/measureCalibrate";
  import { type PageOverrides, fromRemembered, pageScaleText, rememberPages, revaluedText, scaleForPage, withPageScale } from "./lib/shell/pageScale";

  // Stamps
  import SignaturesDialog, { type SignaturesView } from "./lib/components/signature/SignaturesDialog.svelte";
  import { armStamp, fieldValues, placeAt, setStampFields, stampVariant, withContent } from "./lib/markup/kinds/stamp";
  import { type StampContent, BUILT_IN, cleanLine, fillFields, filledStamp, lineOf, sanitiseOwnTexts, subFor, withLine, refOf, textFromRef } from "./lib/markup/stamps";
  import { setImageReady, preloadImage } from "./lib/engine/stampImages";
  import { type Picture, PICTURE_EXTENSIONS, getStamp, openPicture, pictureContent, signatureContent } from "./lib/stamps/api";
  import { type SignatureItem, listSignatures, signatureMessage } from "./lib/signature/api";
  // Stage 8: the stamp tools' pickers in the context bar
  import StampGrid, { type Family as StampFamily } from "./lib/components/signature/StampGrid.svelte";
  import StampsDialog from "./lib/components/signature/StampsDialog.svelte";
  import type { Out } from "./lib/shell/popout";
  import { imageContent } from "./lib/markup/stamps";
  import { newId, type Pt } from "./lib/markup/types";
  import { open as pickPicture } from "@tauri-apps/plugin-dialog";
  import { bakeQuestion, newSignatureIds, withBakes } from "./lib/shell/save";
  import type { Change } from "./lib/markup/spec";

  // Text markups
  import SelectionBar from "./lib/components/SelectionBar.svelte";
  import NoteLayer from "./lib/components/NoteLayer.svelte";
  import { markupPages } from "./lib/markup/listing";
  import { shapeBounds } from "./lib/markup/geometry";
  import { selectionEnd, selectionLines } from "./lib/engine/textTool";
  import type { Quad } from "./lib/text/quads";
  import { type TextMarkVariant, textMarkStyle, textMarksFrom } from "./lib/markup/kinds/textmark";
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
  import { blockedWhileTyping, isTyping, isWebViewAccelerator } from "./lib/engine/keys";
  import { rendererFor, pdfRenderer } from "./lib/render/createRenderer";
  import type { DocInfo, ScaleCandidate } from "./lib/render/types";
  import type { LayoutMode } from "./lib/view/layout";
  import { PT_TO_CSS, screenToWorld, ZOOM_PRESETS, mapUseful } from "./lib/view/viewMath";
  import { unrotatePoint } from "./lib/view/rotation";
  import type { PageRect, PrintContext } from "./lib/print/context";
  import { loadSettings, saveSettings, type Settings } from "./lib/settings";
  import {
    appendPerfLog, jsHeapMb, launchArgs, memoryStats, onForwardedFiles, openUrl, pickFiles, pickFolder, pickSavePdf, revealInExplorer,
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
    /** This tab's markups (engine/markupDoc.ts). */
    marks: MarkupDoc;
    /** The file's size and time when opened or last saved, to notice changes on disk. */
    stamp: Stamp | null;
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

  // ------------------------------------------------------------------ reading: text, links, search

  /** Text selection and links on the canvas (engine/textTool.ts); made with the viewer. */
  let textTool: TextTool | null = null;
  /** Whole-document search, one session per document (engine/search.ts). */
  let search: SearchController | null = null;
  let searchField = $state<SearchField>();
  let textUi = $state({ hasSelection: false, link: "" });
  let searchView = $state.raw<SearchView | null>(null);
  let searchOpts = $state({ matchCase: false, wholeWord: false });

  function refreshText() {
    const t = textTool;
    if (!t) return;
    textUi = { hasSelection: t.hasSelection, link: t.hoverLink ? linkLabel(t.hoverLink, viewer?.doc?.numPages ?? 0) : "" };
  }

  function refreshSearch() {
    const s = search?.session;
    searchView = s
      ? {
          query: s.query, hits: s.list.hits.slice(), current: s.current, running: s.running, scanned: s.list.scanned,
          numPages: s.numPages, withText: s.list.withText, truncated: s.list.truncated, error: s.error,
        }
      : null;
  }

  /** The attached document changed (tab switch, open, close): selection and highlights follow. */
  function readingFollowsDoc() {
    markupTool?.attach(active?.status === "open" ? active.marks : null);
    // Existing annotations: who you are (for the lock), and anything changed while away lifted.
    if (active) active.marks.author = settings.markup.author ?? author;
    liftNow();
    markVersion++;
    textTool?.reset();
    search?.paint();
    refreshSearch();
    refreshText();
  }

  function runSearch(q: string) {
    search?.search(q, { ...searchOpts });
  }

  function toggleSearchOption(o: "matchCase" | "wholeWord") {
    searchOpts[o] = !searchOpts[o];
    if (searchView?.query) runSearch(searchView.query);
  }

  async function copySelection() {
    const text = await textTool?.selectedText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn("copy failed:", String(e));
      notify("Couldn't copy the text to the clipboard");
    }
  }

  function followUrl(url: string) {
    openUrl(url).catch((e) => notify(userMessage(e, "open the link")));
  }

  // ------------------------------------------------------------------ markups (editing phases 2 and 3)

  /** Drawing and editing markups on the canvas (engine/markupTool.ts); made with the viewer. */
  let markupTool: MarkupTool | null = null;
  /** Bumped whenever the markup tool reports a change, so derived UI re-reads it. */
  let markVersion = $state(0);
  /** The account's display name, written into markups unless one is set in the settings. */
  let author = $state("");
  /** A question waiting for an answer (ChoiceDialog). */
  let choice = $state.raw<{ title: string; message: string; warnings?: string[]; note?: string | null; choices: Choice[]; onCancel: () => void } | null>(null);

  /** Ask a question; resolves with the chosen label, or null if dismissed. */
  function ask(title: string, message: string, labels: string[], extra: { warnings?: string[]; note?: string | null } = {}): Promise<string | null> {
    return new Promise((resolve) => {
      const done = (v: string | null) => {
        choice = null;
        resolve(v);
      };
      choice = {
        title, message, ...extra,
        choices: labels.map((label, i) => ({ label, primary: i === 0, action: () => done(label) })),
        onCancel: () => done(null),
      };
    });
  }

  const toolNow = $derived.by<Tool>(() => {
    void markVersion;
    return markupTool?.tool ?? "select";
  });

  function setTool(t: Tool) {
    // Calibrate goes back to the measuring tool that was out before it (else Length).
    const was = markupTool?.tool;
    if (t === "measureCalibrate" && was !== "measureCalibrate") calibrateFrom = was && toolById(was)?.group === "measure" ? was : "measureLength";
    markupTool?.setTool(t);
    stampToolPicked(t); // Stamps: the Signature and Stamp tools open their pickers
    // A collapsed palette shows each group's last tool, remembered between runs.
    const g = toolById(t)?.group;
    // And each letter its last tool (rule 8: a shared letter picks the one last used).
    const key = toolById(t)?.key;
    if ((g && settings.markup.lastInGroup[g] !== t) || (key && settings.markup.lastForKey[key] !== t)) {
      settings.markup = {
        ...settings.markup,
        lastInGroup: g ? { ...settings.markup.lastInGroup, [g]: t } : settings.markup.lastInGroup,
        lastForKey: key ? { ...settings.markup.lastForKey, [key]: t } : settings.markup.lastForKey,
      };
      save();
    }
  }

  function onMarkupsChanged() {
    markVersion++;
    liftNow(); // Existing annotations: anything from the file that changed or went
    scheduleRecovery();
  }

  /**
   * What the properties strip shows (rule 6: only the controls that do something, markup/bar.ts):
   * the tool's style, or the selection's. `tool`: the tool whose remembered settings the bar
   * also sets (rule 7: with a tool out, the selection is only what it just drew; in Select,
   * restyling a markup changes that markup only).
   */
  const strip = $derived.by(() => {
    void markVersion;
    const mt = markupTool;
    if (!mt || !pdfDoc) return null;
    const tool = toolById(mt.tool);
    // The Stamp and Signature tools (Matt's review): no bar until one is placed; then the bar is
    // that one's (still selected), and what's changed there is remembered for the next.
    if (tool && (tool.id === "stamp" || tool.id === "signature")) {
      const sel = mt.selected();
      const m = sel.length === 1 && sel[0].kind === "stamp" ? sel[0] : null;
      const bar = m ? barFor([subjectOf(m)]) : null;
      return m && bar ? { bar, kinds: [m.kind], tool: tool.id, style: m.style, text: null, label: labelOf(m), sides: null } : null;
    }
    if (tool?.kind) {
      // Stage 8: a stamp tool's bar follows what it has armed (a text stamp has a colour).
      const armed = isStampTool(tool.id) ? stampArmed[tool.id] : undefined;
      // The Image tool's is a picture's bar; the Stamp tool with an image stamp armed keeps its picker.
      const armedAs = armed ? stampVariant(armed.content, tool.id === "signature") : null;
      const variant = !isStampTool(tool.id) ? undefined : tool.id === "image" ? "picture" : armedAs === "picture" ? "image" : (armedAs ?? (tool.id === "stamp" ? "text" : tool.id));
      const bar = barFor([subjectOfTool(tool, variant)]);
      if (!bar) return null;
      const own = styleFor(settings.markup, tool.id);
      const style = armed?.content.type === "text" ? { ...own, stroke: armed.content.colour } : own;
      return { bar, kinds: [tool.kind], tool: tool.id, style, text: bar.text ? textFor(settings.markup, tool.id) : null, label: `${tool.label} tool`, sides: bar.sides ? sidesFor(settings.markup, tool.id) : null };
    }
    const sel = mt.selected();
    // Several kinds: only the controls they all have; none (a stamp, an annotation Vellum can't redraw), no bar.
    const bar = barFor(sel.map(subjectOf));
    if (!bar) return null;
    const kinds = [...new Set(sel.map((m) => m.kind))];
    const t = sel.find((m) => "textStyle" in m) as Extract<Markup, { textStyle: TextStyle }> | undefined;
    return { bar, kinds, tool: null, style: sel[0].style, text: t ? t.textStyle : null, label: sel.length === 1 ? labelOf(sel[0]) : `${sel.length} markups selected`, sides: bar.sides ? mt.selectedSides() : null };
  });

  /**
   * The bar's replace button (Matt's review): a stamp or signature selected, or just placed with
   * its tool still out (then what's picked is also what's placed next). Not a picture (its
   * right-click has "Replace picture…", a file).
   */
  const swapStrip = $derived.by(() => {
    void markVersion;
    const mt = markupTool;
    const sel = mt?.selected() ?? [];
    const m = sel.length === 1 && sel[0].kind === "stamp" ? sel[0] : null;
    const toolOut = strip?.tool === "stamp" || strip?.tool === "signature";
    if (!m || (m.content.type === "image" && !m.signature && !toolOut)) return null;
    const family: StampFamily = m.signature ? "signature" : "stamp";
    return {
      content: m.content,
      title: m.signature ? "Another signature in its place" : "Another stamp in its place",
      onOpen: (from: DOMRect, out: Out) => (stampGrid = { family, replace: true, from, out, arm: toolOut }),
    };
  });

  /** A text stamp's second line, on or off, in the bar (the stamp selected, or just placed). */
  const dateLineStrip = $derived.by(() => {
    void markVersion;
    if (!strip?.bar.dateLine) return null;
    const m = markupTool?.selected()[0];
    return m?.kind === "stamp" && m.content.type === "text" ? { on: !!m.content.sub, onToggle: setDateLine } : null;
  });

  /** Cropping (Matt's review): the bar's Crop for the one selected picture. */
  const cropStrip = $derived.by(() => {
    void markVersion;
    const mt = markupTool;
    if (!mt || mt.tool !== "select" || !mt.croppable) return null;
    const s = mt.selected()[0];
    return {
      on: mt.cropping,
      cropped: s.kind === "stamp" && s.content.type === "image" && !!s.content.crop,
      onToggle: () => mt.setCropping(!mt.cropping),
      onReset: () => mt.uncrop(),
    };
  });

  /** Stage 6: Sides set in the bar: remembered with the tool out (rule 7), and the selection's regular polygons change. */
  function stripSides(n: number) {
    const mt = markupTool;
    if (!mt) return;
    const id = strip?.tool;
    if (id) {
      settings.markup = { ...settings.markup, sides: { ...settings.markup.sides, [id]: n } };
      save();
    }
    mt.setSides(n);
    markVersion++;
  }

  /** The properties bar's dock while it's being dragged (saved when let go). */
  let liveDock = $state<Dock | null>(null);

  function stripStyle(patch: Partial<Style>, live = false) {
    const mt = markupTool;
    if (!mt || !strip) return;
    // A slider being dragged: show it on the markups, but remember nothing until it's let go.
    if (live) {
      mt.preview(patch);
      return;
    }
    // Each tool remembers its last style: set with the tool out (rule 7).
    const id = strip.tool;
    if (id) {
      settings.markup = { ...settings.markup, styles: { ...settings.markup.styles, [id]: { ...styleFor(settings.markup, id), ...patch } } };
      save();
    }
    // Stage 8: a text stamp's colour is what it places next.
    if (id === "stamp" && patch.stroke) recolourArmed(patch.stroke);
    // The selection: what is picked out, or with a drawing tool, the shape just drawn.
    mt.restyle(patch);
    markVersion++;
  }

  function stripText(patch: Partial<TextStyle>) {
    const mt = markupTool;
    if (!mt) return;
    const id = strip?.tool;
    if (id) {
      settings.markup = { ...settings.markup, texts: { ...settings.markup.texts, [id]: { ...textFor(settings.markup, id), ...patch } } };
      save();
    }
    mt.restyle({}, patch);
    markVersion++;
  }

  /** The text box being typed into, placed on screen. */
  const editor = $derived.by(() => {
    void markVersion;
    void [ui.viewWorld.x, ui.viewWorld.y, ui.zoom, ui.rotation];
    const v = viewer;
    const m = markupTool?.editingMarkup();
    if (!v || !m) return null;
    const tl = v.pageToScreen(m.page, m.rect[0], m.rect[1]);
    if (!tl) return null;
    return {
      id: m.id, x: tl[0], y: tl[1], w: (m.rect[2] - m.rect[0]) * v.view.scale, h: (m.rect[3] - m.rect[1]) * v.view.scale,
      rotation: ui.rotation, scale: v.view.scale, textStyle: m.textStyle, pad: TEXT_PAD + m.style.width, text: m.text,
    };
  });

  // Later markup phases add their state and handlers inside their own block:
  // Measuring (phase 4: per-page scales, calibration, live values, the loupe; see
  // docs/editing-phase4-scope.md)

  /** A tab's own per-page scales, remembered per file. */
  function pagesOf(t: Tab | null | undefined): PageOverrides {
    return t ? fromRemembered(settings.measure.pageScales[pathKey(t.path)]) : {};
  }

  /** /UserUnit per page, by tab id: read when measuring first starts on a tab (empty while read). */
  let userUnits = $state<Record<number, number[]>>({});

  /** How a page of a tab measures: its scale (own or the document's) and its /UserUnit. */
  function pageMeasure(t: Tab | null | undefined, page: number): PageMeasure {
    if (!t) return { ratio: null, userUnit: 1 };
    return { ratio: scaleForPage(t.scale, pagesOf(t), page)?.ratio ?? null, userUnit: userUnits[t.id]?.[page] ?? 1 };
  }

  // New measurements take their page's scale, and the format and label size set in the bar.
  // Imperial (stage 5 [A9]): the format comes with View > Units as what Auto resolves to.
  setMeasureSource({ page: (p) => pageMeasure(active, p), format: () => viewFormat(settings.measure.format), labelSize: () => settings.measure.labelSize });

  /** Imperial (stage 5 [A9]): a format with Auto resolved to View > Units. */
  function viewFormat(f: MeasureFormat): MeasureFormat {
    return { ...f, system: settings.units };
  }
  setDimensionLook(() => settings.measure.look); // Dimensions (stage 5)

  /** A measuring tool (Calibrate included) is out. */
  const measuring = $derived(toolById(toolNow)?.group === "measure");

  /** Two points picked with Calibrate, waiting for the real length (CalibrateDialog). */
  let calib = $state<{ tabId: number; page: number; paperMm: number } | null>(null);

  /** Asked before a drawn markup is kept: Calibrate's points go to the dialog instead. */
  function keepDrawn(m: Markup): boolean {
    if (m.kind === "measureCalibrate") {
      const t = active;
      if (t) calib = { tabId: t.id, page: m.page, paperMm: calibratePaperMm(m) };
      return false;
    }
    // An angle dragged out as a line has two points: no angle.
    if (m.kind === "measureAngle") return m.vertices.length === 3;
    return true;
  }
  $effect(() => {
    if (viewer && markupTool) markupTool.keep = keepDrawn;
  });

  /** Set (or with null, clear) one page's own scale, remembered for the file. */
  function setPageScale(t: Tab, page: number, ratio: number | null) {
    const pages = withPageScale(pagesOf(t), page, ratio === null ? null : { ratio, source: "manual" });
    settings.measure = { ...settings.measure, pageScales: rememberPages(settings.measure.pageScales, pathKey(t.path), pages) };
    save();
  }

  /** The measuring tool to return to once a calibration is done or cancelled. */
  let calibrateFrom: Tool = "measureLength";

  /** Calibrating finished or cancelled: back to the measuring tool that was out before. */
  function calibrationDone() {
    calib = null;
    if (markupTool?.tool === "measureCalibrate") setTool(calibrateFrom);
  }

  function applyCalibration(ratio: number, pageOnly: boolean) {
    const c = calib;
    calibrationDone();
    const t = c ? tabById(c.tabId) : null;
    if (!c || !t) return;
    if (pageOnly) setPageScale(t, c.page, ratio);
    else {
      // Every page: the document's scale, and no page keeps one of its own.
      applyScale(ratio);
      settings.measure = { ...settings.measure, pageScales: rememberPages(settings.measure.pageScales, pathKey(t.path), {}) };
      save();
    }
  }

  // Read the pages' /UserUnit once measuring starts on a PDF (nearly always 1: a sheet over
  // 200 inches uses it). Not on open, so opening never waits for it.
  $effect(() => {
    const t = active;
    if (!measuring || !t || t.kind !== "pdf" || t.status !== "open" || untrack(() => userUnits[t.id])) return;
    const id = t.id;
    userUnits = { ...untrack(() => userUnits), [id]: [] };
    invoke<number[]>("measure_user_units", { path: t.path, password: t.password })
      .then((u) => {
        if (u.some((x) => x !== 1)) console.info("measuring: pages with /UserUnit:", u.map((x, i) => (x !== 1 ? `${i + 1}=${x}` : "")).filter(Boolean).join(" "));
        userUnits = { ...userUnits, [id]: u };
      })
      .catch((e) => console.warn("measuring: couldn't read /UserUnit, taking 1:", String(e)));
  });

  /**
   * Measurements follow their page's scale: whenever it changes (or an undo brings back older
   * values), re-value them in place, with no undo step of their own, and say how many. Their
   * units and decimals are each one's own (set from the bar, rule 7).
   */
  const scaleSeen = new Map<number, string>();
  $effect(() => {
    void markVersion;
    const t = active;
    const v = viewer;
    if (!t || t.status !== "open" || !v || !markupTool) return;
    const sig = JSON.stringify([t.scale?.ratio ?? null, settings.measure.pageScales[pathKey(t.path)] ?? null, userUnits[t.id] ?? null]);
    const units = settings.units; // Imperial (stage 5 [A9]): Auto follows View > Units
    untrack(() => {
      const r = revalue(t.marks.markups, null, (p) => pageMeasure(t, p));
      r.markups = resolveAuto(r.markups, units); // Imperial (stage 5 [A9])
      const before = scaleSeen.get(t.id);
      scaleSeen.set(t.id, sig);
      if (r.markups !== t.marks.markups) {
        t.marks.history.replace(r.markups);
        v.requestFrame();
        onMarkupsChanged();
      }
      if (before !== undefined && before !== sig) {
        const msg = revaluedText(r.changed);
        if (msg) notify(msg);
      }
    });
  });

  /**
   * The properties bar's measuring section: label size and number format. Like every control,
   * it changes the selection; with a measuring tool out, the tools remember it (rule 7).
   */
  function onMeasure(patch: { labelSize?: number; format?: MeasureFormat }) {
    const t = active;
    const mt = markupTool;
    if (mt && toolById(mt.tool)?.group === "measure") {
      settings.measure = { ...settings.measure, ...patch };
      // Imperial (stage 5 [A9]): the view's system isn't remembered with the format.
      if (patch.format) settings.measure.format = { ...patch.format, system: undefined };
      save();
    }
    if (t && mt) {
      const ids = new Set(mt.selected().map((m) => m.id));
      let next = t.marks.markups;
      if (patch.labelSize) next = resizeLabels(next, ids, patch.labelSize);
      if (patch.format) next = reformat(next, patch.format, ids).markups;
      if (next !== t.marks.markups) {
        t.marks.history.push(next);
        viewer?.requestFrame();
      }
    }
    onMarkupsChanged();
  }

  /** The right-click menu's "Apply to all measurements": every one takes this one's units and decimals. */
  function formatAllLike(fmt: MeasureFormat) {
    const t = active;
    if (!t) return;
    const r = reformat(t.marks.markups, fmt);
    if (!r.changed) return;
    t.marks.history.push(r.markups);
    viewer?.requestFrame();
    onMarkupsChanged();
    notify(r.changed === 1 ? "1 measurement changed" : `${r.changed} measurements changed`);
  }

  const measureStrip = $derived.by(() => {
    void markVersion;
    const mt = markupTool;
    if (!mt) return {};
    const tool = toolById(mt.tool);
    const ms = { labelSize: settings.measure.labelSize, format: viewFormat(settings.measure.format) };
    if (tool?.kind) return tool.group === "measure" && tool.kind !== "measureCalibrate" ? { measure: ms, onMeasure } : {};
    const sel = mt.selected();
    if (!sel.length || !sel.every(isMeasurement)) return {};
    return { measure: { labelSize: sel[0].labelSize, format: sel[0].fmt }, onMeasure };
  });

  // Dimensions (stage 5)
  /**
   * The bar's dimension controls: the ends (only where every measurement involved has a
   * dimension line) and the value's font. Like every control they change the selection; with a
   * measuring tool out, the tools remember them (rule 7).
   */
  function onDimension(patch: Partial<DimensionLook>) {
    const t = active;
    const mt = markupTool;
    if (mt && toolById(mt.tool)?.group === "measure") {
      settings.measure = { ...settings.measure, look: { ...settings.measure.look, ...patch } };
      save();
    }
    if (t && mt) {
      const next = relook(t.marks.markups, new Set(mt.selected().map((m) => m.id)), patch);
      if (next !== t.marks.markups) {
        t.marks.history.push(next);
        viewer?.requestFrame();
      }
    }
    onMarkupsChanged();
  }

  const dimensionStrip = $derived.by(() => {
    void markVersion;
    const mt = markupTool;
    if (!mt) return {};
    const tool = toolById(mt.tool);
    const look = settings.measure.look;
    if (tool?.kind) {
      if (tool.group !== "measure" || tool.kind === "measureCalibrate") return {};
      return { dimension: { ends: hasEnds({ kind: tool.kind }) ? look.ends : null, font: look.font }, onDimension };
    }
    const sel = mt.selected();
    if (!sel.length || !sel.every(isMeasurement)) return {};
    const m = sel[0] as Measurement;
    return { dimension: { ends: sel.every(hasEnds) ? (m.ends ?? "bar") : null, font: m.font ?? "helvetica" }, onDimension };
  });
  // End dimensions

  const measureBar = $derived.by(() => {
    void markVersion;
    void ui.cursor;
    const t = active;
    if (!hasDoc || !t) return {};
    const mt = markupTool;
    const d = mt?.drawingShape();
    let line = d ? drawingLine(d.markup, d.segment) : null;
    if (!line && mt) {
      const sel = mt.selected();
      if (sel.length === 1) line = measurementLine(sel[0]);
    }
    const noScale = measuring && pageMeasure(t, ui.page).ratio === null;
    return {
      scaleText: pageScaleText(t.scale, pagesOf(t), ui.page, settings.units),
      measure: line,
      onCalibrate: noScale && toolNow !== "measureCalibrate" ? () => setTool("measureCalibrate") : null,
    };
  });

  const measureScaleDialog = $derived.by(() => {
    const t = active;
    if (!t?.info || t.info.numPages < 2) return {};
    const page = ui.page;
    return {
      page: page + 1,
      pageScale: pagesOf(t)[page] ?? null,
      onApplyPage: (r: number | null) => {
        setPageScale(t, page, r);
        dialog = null;
      },
    };
  });
  // End measuring

  // Stamps
  /**
   * The stamp tools' grid (Matt's review): open beside the tool's button once the tool is
   * picked, or, `replace`, at a placed one's right-click to swap what it holds.
   */
  /** Manage stamps (docs/stamp-library-dialogs-scope.md). */
  let stampsDialog = $state(false);
  let stampGrid = $state<{ family: StampFamily; replace?: boolean; at?: { x: number; y: number }; from?: DOMRect; out?: Out; arm?: boolean } | null>(null);
  /** The Signatures dialog, and the view it opened on: the list (Manage signatures) or the pad (+ New). */
  let signaturesDialog = $state<SignaturesView | null>(null);
  /**
   * What each stamp tool last had armed in this run, so switching between them keeps each one's
   * choice; `id` is its library id (an image stamp's, a signature's), `name` a picture's file name.
   */
  let stampArmed = $state.raw<Partial<Record<StampTool, { content: StampContent; id?: string; name?: string }>>>({});
  /** Per tab: the signatures the save in progress bakes in (the bake question's answer). */
  const pendingBake = new WeakMap<Tab, Set<string>>();

  // A stamp's picture decoded after it was first drawn: draw again.
  setImageReady(() => viewer?.requestFrame());
  // A text stamp's fields (Matt's review): who, and which file, when it's placed.
  setStampFields((page) => ({ author: settings.markup.author ?? author, now: new Date(), file: active?.title ?? "", page }));

  function stampToolPicked(t: Tool) {
    if (!isStampTool(t)) return;
    const prev = stampArmed[t];
    armStamp(prev?.content ?? null, t === "signature");
    // The Image tool asks for a picture each time it's picked (Matt's review), then places it.
    if (t === "image") {
      void choosePicture(false);
      return;
    }
    // The grid opens beside the tool's button, with what the tool last placed already armed:
    // a click on the drawing places that; a tile arms another.
    stampGrid = { family: t };
    if (!prev) void armRemembered(t);
  }

  // The tool changed some other way (Esc, a tab closing): the picker goes with it.
  $effect(() => {
    if (stampGrid && !stampGrid.replace && toolNow !== stampGrid.family) stampGrid = null;
  });

  /** Replace…: what the one selected stamp holds now (to mark it in the grid). */
  const replacing = $derived.by((): StampContent | null => {
    void markVersion;
    const m = markupTool?.selected()[0];
    return m?.kind === "stamp" ? m.content : null;
  });

  /** A tile picked in the grid: what the tool places next, or (Replace…) what the selected one holds. */
  function gridPicked(c: StampContent, id?: string) {
    const g = stampGrid;
    stampGrid = null;
    if (g?.replace) replaceSelectedStamp(c, false);
    // From the bar with the tool out: the one just placed is swapped, and it's what comes next too.
    if (!g?.replace || g.arm) armFor(g?.family ?? "stamp", c, id);
  }

  async function gridPickedSignature(item: SignatureItem) {
    const g = stampGrid;
    stampGrid = null;
    if (!g?.replace) return pickSignature(item);
    try {
      const c = await signatureContent(item);
      if (!c) throw new Error("[signature_unreadable] no strokes or picture");
      replaceSelectedStamp(c, true);
      if (g.arm) armFor("signature", c, item.id);
    } catch (e) {
      console.warn(`signature ${item.id} could not be placed`);
      notify(signatureMessage(e, "use the signature"));
    }
  }

  /** Arm a stamp tool with what was picked, and close its picker. `id`: its library id. */
  function armFor(tool: StampTool, c: StampContent, id?: string, name?: string) {
    stampArmed = { ...stampArmed, [tool]: { content: c, id, name } };
    armStamp(c, tool === "signature");
    if (c.type === "image") preloadImage(c.hash, c.png);
    remember(tool, c, id);
    if (markupTool?.tool !== tool) setTool(tool);
    stampGrid = null;
  }

  async function pickSignature(item: SignatureItem) {
    try {
      const c = await signatureContent(item);
      if (!c) throw new Error("[signature_unreadable] no strokes or picture");
      armFor("signature", c, item.id);
    } catch (e) {
      // By id only: a signature's data never goes in the log.
      console.warn(`signature ${item.id} could not be placed`);
      notify(signatureMessage(e, "use the signature"));
    }
  }

  /** The Signatures dialog saved a new one: it's what the Signature tool places next. */
  function newSignatureSaved(item: SignatureItem) {
    void pickSignature(item);
  }

  /** A signature deleted in the Signatures dialog: not left armed, nor remembered. */
  function signatureDeleted(id: string) {
    if (stampArmed.signature?.id === id) {
      const { signature: _gone, ...rest } = stampArmed;
      stampArmed = rest;
      if (markupTool?.tool === "signature") armStamp(null, true);
    }
    if (settings.stamps.last.signature === id) {
      const { signature: _was, ...last } = settings.stamps.last;
      settings.stamps = { ...settings.stamps, last };
      save();
    }
  }

  // Stage 8: the pickers in the context bar, the Image tool, pasted pictures
  // (docs/editing-tool-consistency-brief.md, stage 8).

  type StampTool = "stamp" | "signature" | "image";
  const isStampTool = (t: string | null | undefined): t is StampTool => t === "stamp" || t === "signature" || t === "image";


  /** Remember what a tool placed, by reference only (never a signature's picture or strokes). */
  function remember(tool: StampTool, c: StampContent, id?: string) {
    const last = settings.stamps.last;
    if (tool === "stamp") {
      const ref = refOf(c, id);
      if (!ref) return;
      settings.stamps = { ...settings.stamps, last: { ...last, stamp: ref } };
    } else if (tool === "signature" && id) settings.stamps = { ...settings.stamps, last: { ...last, signature: id } };
    else return;
    save();
  }

  /** Arm what a tool last placed (in an earlier run), from its reference; the tool must still be out. */
  async function armRemembered(t: "stamp" | "signature") {
    const still = () => markupTool?.tool === t && !stampArmed[t];
    const arm = (c: StampContent, id?: string) => {
      if (!still()) return;
      stampArmed = { ...stampArmed, [t]: { content: c, id } };
      armStamp(c, t === "signature");
      if (c.type === "image") preloadImage(c.hash, c.png);
    };
    const last = settings.stamps.last;
    if (t === "stamp") {
      const r = last.stamp;
      if (r?.type === "image") {
        const c = await getStamp(r.id).then(imageContent).catch(() => null);
        if (c) return arm(c, r.id);
      }
      const ref = r?.type === "text" ? r : { type: "text" as const, ...BUILT_IN[0] };
      return arm(textFromRef(ref, subFor(settings.stamps, ref.label)));
    }
    try {
      const item = last.signature ? (await listSignatures()).items.find((i) => i.id === last.signature) : undefined;
      const c = item ? await signatureContent(item) : null;
      if (item && c) return arm(c, item.id);
    } catch {
      // By id only: a signature's data never goes in the log.
      console.warn(`signature ${last.signature} could not be armed again`);
    }
    // None remembered, or it's gone: the grid (open already) offers them, and "+ New".
  }

  /** The one selected stamp holds `c` now: same middle and turn (one undo step). */
  function replaceSelectedStamp(c: StampContent, signature: boolean) {
    const mt = markupTool;
    const sel = mt?.selected() ?? [];
    if (!mt || sel.length !== 1 || sel[0].kind !== "stamp") return;
    if (c.type === "image") preloadImage(c.hash, c.png);
    // A text stamp's fields, filled in for the page the one it replaces is on.
    const filled = c.type === "text" ? filledStamp(c, fieldValues(sel[0].page)) : c;
    mt.updateMarkup(withContent(sel[0], filled, signature));
  }

  /** The selected stamps changed by `f`, as one undo step. */
  function changeSelectedStamps(f: (m: Extract<Markup, { kind: "stamp" }>) => Markup) {
    const t = active;
    const mt = markupTool;
    if (!t || !mt) return;
    const now = new Date().toISOString();
    let changed = false;
    const next = t.marks.markups.map((m) => {
      if (m.kind !== "stamp" || !t.marks.selection.has(m.id)) return m;
      const n = f(m);
      if (n === m) return m;
      changed = true;
      return { ...n, meta: { ...n.meta, modified: now } } as Markup;
    });
    if (!changed) return;
    t.marks.history.push(next);
    viewer?.requestFrame();
    onMarkupsChanged();
  }

  /**
   * The bar's Second line, on or off, for the selected text stamp (this one placed). With the
   * Stamp tool out it's also what that stamp places next (rule 7), remembered for it.
   */
  function setDateLine(on: boolean) {
    const m0 = markupTool?.selected()[0];
    const label = m0?.kind === "stamp" && m0.content.type === "text" ? (m0.content.fields?.label ?? m0.content.label) : null;
    if (strip?.tool === "stamp" && label) {
      settings.stamps = withLine(settings.stamps, label, { sub: on });
      save();
      const a = stampArmed.stamp;
      if (a?.content.type === "text" && (a.content.fields?.label ?? a.content.label) === label) {
        const c = { ...a.content, sub: subFor(settings.stamps, label) };
        stampArmed = { ...stampArmed, stamp: { ...a, content: c } };
        armStamp(c, false);
      }
    }
    const sub = label ? lineOf(settings.stamps, label).wording : settings.stamps.line;
    const placed = on ? sub : null;
    // A placed stamp's second line is filled in for its page now (its main line as it was placed).
    changeSelectedStamps((m) => {
      if (m.content.type !== "text" || !!m.content.sub === on) return m;
      const { fields, ...c } = m.content;
      return withContent(m, filledStamp({ ...c, label: fields?.label ?? c.label, sub: placed }, fieldValues(m.page)));
    });
  }

  /** What a stamp field would say placed on the page in view now (a chip's tooltip). */
  const fieldValue = (f: string) => fillFields(`{${f}}`, fieldValues(viewer?.currentPageIndex ?? null));

  /** One of your own text stamps added from the grid's "+ Your wording" (kept, a tile of its own). */
  function addOwnText(label: string, colour: Style["stroke"]) {
    const texts = sanitiseOwnTexts([...settings.stamps.texts, { label, colour }]);
    settings.stamps = { ...settings.stamps, texts };
    save();
  }

  /** The text stamp a grid's second-line section is for: the armed (or replaced) one's wording as kept. */
  const gridLineLabel = (c: StampContent | null): string | null => (c?.type === "text" ? (c.fields?.label ?? c.label) : null);

  /**
   * One stamp's second line set in the grid (Matt's review: per stamp): remembered for it, what
   * the Stamp tool places next if that's the one armed, and, replacing, the placed one too.
   */
  function setLineFor(label: string, patch: { sub?: boolean; line?: string }) {
    settings.stamps = withLine(settings.stamps, label, patch.line === undefined ? patch : { ...patch, line: cleanLine(patch.line) });
    save();
    const sub = subFor(settings.stamps, label);
    const a = stampArmed.stamp;
    if (a?.content.type === "text" && (a.content.fields?.label ?? a.content.label) === label) {
      const c = { ...a.content, sub };
      stampArmed = { ...stampArmed, stamp: { ...a, content: c } };
      armStamp(c, false);
    }
    if (stampGrid?.replace)
      changeSelectedStamps((m) => {
        if (m.content.type !== "text") return m;
        const { fields, ...c } = m.content;
        return withContent(m, filledStamp({ ...c, label: fields?.label ?? c.label, sub }, fieldValues(m.page)));
      });
  }

  /** The bar's colour with the Stamp tool out: the text stamp it places next takes it (remembered). */
  function recolourArmed(colour: Style["stroke"]) {
    const a = stampArmed.stamp;
    if (a?.content.type !== "text") return;
    const c = { ...a.content, colour };
    stampArmed = { ...stampArmed, stamp: { ...a, content: c } };
    armStamp(c, false);
    remember("stamp", c);
  }

  /** The full library (rename, delete, add): Manage stamps, or the Signatures dialog's list. */
  function manageStamps(family: StampFamily) {
    if (family === "stamp") stampsDialog = true;
    else signaturesDialog = "list";
  }

  /**
   * The Image tool: pick a picture file (scaled to 2000 px on its long side on the way in) and
   * place it; nothing goes in the stamp library. `forSelection`: it replaces the selected picture.
   */
  async function choosePicture(forSelection: boolean) {
    const back = () => {
      if (!forSelection && markupTool?.tool === "image" && !stampArmed.image) setTool("select");
    };
    const path = await pickPicture({ title: "Place a picture", multiple: false, filters: [{ name: "Pictures", extensions: PICTURE_EXTENSIONS }] }).catch(() => null);
    if (typeof path !== "string") return back();
    try {
      const c = await pictureContent(await openPicture(path));
      if (!c) throw new Error("[picture_unreadable] not a PNG");
      if (forSelection) return replaceSelectedStamp(c, false);
      if (markupTool?.tool !== "image") return;
      armFor("image", c, undefined, path.split(/[\\/]/).pop());
    } catch (e) {
      console.warn("image tool: the picture could not be opened:", String(e).slice(0, 200));
      notify(userMessage(e, "open the picture"));
      back();
    }
  }

  /** A picture pasted from the clipboard: an Image markup centred on `at`, upright as viewed. */
  async function placePicture(pic: Picture, page: number, at: Pt) {
    const mt = markupTool;
    const c = await pictureContent(pic).catch(() => null);
    if (!mt || !c) {
      notify("Couldn't paste the picture");
      return;
    }
    if (c.type === "image") preloadImage(c.hash, c.png);
    const now = new Date().toISOString();
    const meta = { author: settings.markup.author ?? author, created: now, modified: now };
    mt.addMarkups([{ id: newId(), page, kind: "stamp", style: styleFor(settings.markup, "image"), meta, ...placeAt(c, false, at, viewer?.rotation ?? 0) } as Markup]);
  }

  /**
   * Before a save: when signatures were placed since the last one, ask whether to bake them in
   * (asked each time). The ids to bake (none to keep them movable), or null if cancelled.
   */
  async function askBake(t: Tab, copy: boolean): Promise<Set<string> | null> {
    const ids = newSignatureIds(t.marks.saved, t.marks.markups as { id: string; kind: string; signature?: boolean }[]);
    if (!ids.length) return new Set();
    const q = bakeQuestion(ids.length, copy);
    const a = await ask(q.title, q.message, [q.keep, q.bake, "Cancel"]);
    if (a === q.bake) return new Set(ids);
    if (a === q.keep) return new Set();
    return null;
  }

  /** The save's changes, with the signatures being baked in drawn into their pages instead. */
  function saveChanges(t: Tab, bake: Set<string> | undefined): Change[] {
    return withBakes(t.marks.changes(), bake ?? new Set()) as Change[];
  }

  /** After a save that baked signatures in: they're part of the page now, not markups (and undo can't bring them back). */
  function afterBake(t: Tab) {
    const ids = pendingBake.get(t);
    pendingBake.delete(t);
    if (!ids?.size) return;
    t.marks.history.forget(ids);
    t.marks.saved = t.marks.saved.filter((m) => !ids.has(m.id));
    for (const id of ids) t.marks.selection.delete(id);
    markupTool?.attach(t.marks);
  }

  // Text markups
  //
  // Highlight, underline and strike through from a text selection: the selection bar beside it,
  // the Edit menu and Ctrl+H / Ctrl+U / Ctrl+Shift+X. Each variant remembers its colour and
  // opacity (settings.textMarks): the last it was made or restyled with.

  /** The sidebar's Markups tab: the active tab's markups by page, the selection, their colours. */
  const markupsTab = $derived.by(() => {
    void markVersion;
    const d = markupTool?.doc;
    const ms = d?.markups ?? [];
    const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
    return {
      pages: markupPages(ms, d ? (m) => !d.editable(m) : undefined),
      selected: new Set(d?.selection ?? []),
      colours: new Map(ms.map((m) => [m.id, css(m.style.stroke)])),
      editable: !!pdfDoc,
    };
  });

  /** A row in the Markups tab clicked: back to Select, select it and bring it into view. */
  function pickMarkup(id: string) {
    const mt = markupTool;
    const m = mt?.doc?.byId(id);
    if (!mt || !m || !viewer) return;
    if (mt.tool !== "select") setTool("select");
    mt.select([id]);
    viewer.revealRect(m.page, shapeBounds(m));
  }

  /** The markup tool for the notes' layer (made with the viewer; markVersion moves when it attaches). */
  const noteTool = $derived.by(() => {
    void markVersion;
    return markupTool;
  });

  /** Where the text selection ends (its last line), for the selection bar. */
  let selEnd = $state.raw<{ page: number; quad: Quad } | null>(null);
  let selSeen: unknown = null;
  $effect(() => {
    void textUi;
    const tt = textTool;
    const s = tt?.selection ?? null;
    if (!tt || s === selSeen) return;
    selSeen = s;
    if (!s) {
      selEnd = null;
      return;
    }
    void selectionEnd(tt).then((e) => {
      if (tt.selection === s) selEnd = e;
    });
  });

  /** The selection bar's place: just past the end of the selection's last line, below it. */
  const selBar = $derived.by(() => {
    void [ui.viewWorld.x, ui.viewWorld.y, ui.zoom, ui.rotation];
    const v = viewer;
    const e = selEnd;
    if (!v || !e || !textUi.hasSelection || toolNow !== "select") return null;
    const pts = e.quad.map((q) => v.pageToScreen(e.page, q[0], q[1]));
    if (pts.some((q) => !q)) return null;
    const xs = pts.map((q) => q![0]), ys = pts.map((q) => q![1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > stageW || Math.max(...ys) < 0 || Math.min(...ys) > stageH) return null;
    return { x: Math.max(...xs) + 4, y: Math.max(...ys) + 6 };
  });

  /** Mark up the selected text: one markup per page, selected so the bar can restyle it. */
  async function markText(variant: TextMarkVariant) {
    const tt = textTool;
    const mt = markupTool;
    if (!tt || !mt || !pdfDoc || !tt.hasSelection) return;
    const lines = await selectionLines(tt);
    const style = settings.textMarks[variant] ?? textMarkStyle(variant);
    const marks = textMarksFrom(lines, variant, style, settings.markup.author ?? author);
    if (!marks.length) return;
    mt.addMarkups(marks);
    tt.clear();
  }

  // A text markup restyled while selected: its variant remembers the style for next time.
  let markStyles = new Map<string, string>();
  $effect(() => {
    void markVersion;
    const sel = (markupTool?.selected() ?? []).filter((m) => m.kind === "textmark");
    const next = new Map(sel.map((m) => [m.id, JSON.stringify([m.style.stroke, m.style.opacity])]));
    for (const m of sel) {
      const was = markStyles.get(m.id);
      if (was !== undefined && was !== next.get(m.id) && m.kind === "textmark") {
        settings.textMarks = { ...settings.textMarks, [m.variant]: { ...textMarkStyle(m.variant), stroke: m.style.stroke, opacity: m.style.opacity } };
        save();
      }
    }
    markStyles = next;
  });

  function textMarkKeys(e: KeyboardEvent) {
    if (modalOpen || isTyping(e) || e.altKey || !(e.ctrlKey || e.metaKey) || !textUi.hasSelection) return;
    const k = e.key.toLowerCase();
    const v: TextMarkVariant | null = !e.shiftKey && k === "h" ? "highlight" : !e.shiftKey && k === "u" ? "underline" : e.shiftKey && k === "x" ? "strike" : null;
    if (!v) return;
    e.preventDefault();
    if (!e.repeat) void markText(v);
  }
  $effect(() => {
    window.addEventListener("keydown", textMarkKeys);
    return () => window.removeEventListener("keydown", textMarkKeys);
  });

  // ---------------------------------------------------------------- saving

  /** Fetch the frames of the pages a save touches. */
  async function ensureFrames(t: Tab, docId: number) {
    for (const page of t.marks.pagesWithoutFrames()) t.marks.frames.set(page, await invoke<Frame>("doc_page_frame", { docId, page }));
  }

  interface Prepared {
    temp: string;
    target: string;
    added: number;
    rebuilt: boolean;
  }

  /** Save the active tab's markups into its file (Ctrl+S). True when saved, or nothing to save. */
  async function saveActive(): Promise<boolean> {
    const t = active;
    const v = viewer;
    const mt = markupTool;
    if (!t || !v || !mt || t.status !== "open" || !v.doc) return false;
    mt.finishText();
    if (!t.marks.dirty) return true;
    if (t.kind !== "pdf") {
      notify("Markups can't be saved into an image yet");
      return false;
    }
    try {
      await ensureFrames(t, v.doc.docId);
      const key = pathKey(t.path);
      if (!settings.markup.confirmed.includes(key)) {
        const info = await invoke<FileInfo>("annot_inspect", { path: t.path, password: t.password });
        const c = saveConfirmation(t.title, info);
        const a = await ask("Save into the file", c.message, ["Save", "Save a copy…", "Cancel"], { warnings: c.warnings, note: c.note });
        if (a === "Save a copy…") return saveCopy();
        if (a !== "Save") return false;
        settings.markup = confirmSave(settings.markup, key);
        save();
      }
      // Stamps: bake placed signatures in, or keep them movable.
      const bake = await askBake(t, false);
      if (!bake) return false;
      pendingBake.set(t, bake);
      return await writeSave(t, v, true);
    } catch (e) {
      return failSave(t, e);
    }
  }

  async function writeSave(t: Tab, v: Viewer, expect: boolean): Promise<boolean> {
    // Existing annotations: positions are the last read's; one under way (after a save) first.
    if (t.marks.reading) await t.marks.reading;
    let p: Prepared;
    try {
      p = await invoke<Prepared>("annot_prepare", { path: t.path, password: t.password, changes: saveChanges(t, pendingBake.get(t)), target: null, expect: expect ? t.stamp : null });
    } catch (e) {
      if (!hasCode(e, "changed_on_disk")) throw e;
      const a = await ask("The file has changed", `${t.title} changed on disk since you opened it. Add your markups to it as it is now?`, ["Save", "Save a copy…", "Cancel"]);
      if (a === "Save") return writeSave(t, v, false);
      if (a === "Save a copy…") return saveCopy();
      return false;
    }
    const oldId = v.doc!.docId;
    // What the overlay goes on drawing is hidden again in the reopened file; the file's
    // untouched annotations are PDFium's to draw (MarkupDoc.hideAfterSave).
    const ids = t.marks.hideAfterSave();
    try {
      await v.reopen(
        () => invoke("annot_commit", { temp: p.temp, target: p.target }),
        async (docId) => {
          for (const [page, nms] of ids) await invoke("doc_hide_annots", { docId, page, nms, hidden: true });
        },
      );
    } catch (e) {
      invoke("annot_discard", { temp: p.temp }).catch(() => {});
      readingFollowsAfterReopen(t, oldId, v);
      void rereadFileAnnots(t);
      throw e;
    }
    t.marks.markSaved();
    void rereadFileAnnots(t); // Existing annotations: where each now sits in the file
    afterBake(t); // Stamps
    readingFollowsAfterReopen(t, oldId, v);
    const stamp = await invoke<Stamp>("file_stamp", { path: t.path }).catch(() => null);
    updateTab(t.id, { stamp });
    invoke("recovery_delete", { key: recoveryKey(pathKey(t.path)) }).catch(() => {});
    markVersion++;
    notify(p.rebuilt ? `Saved ${t.title} (the file was rewritten to repair it)` : `Saved ${t.title}`);
    return true;
  }

  /** After a reopen the document has a new id: move the tab and the caches over to it. */
  function readingFollowsAfterReopen(t: Tab, oldId: number, v: Viewer) {
    if (!v.doc || v.doc.docId === oldId) return;
    textTool?.forgetDoc(oldId);
    search?.forgetDoc(oldId);
    updateTab(t.id, { info: v.doc });
    readingFollowsDoc();
  }

  async function failSave(t: Tab, e: unknown): Promise<boolean> {
    console.warn("save failed:", String((e as Error)?.message ?? e));
    const a = await ask("Couldn't save", `${userMessage(e, `save ${t.title}`)} Your markups are still here.`, ["Save a copy…", "Close"]);
    if (a === "Save a copy…") return saveCopy();
    return false;
  }

  /** Save the markups into a copy of the file, staying on the original (Ctrl+Shift+S). */
  async function saveCopy(): Promise<boolean> {
    const t = active;
    const v = viewer;
    if (!t || !v || !markupTool || t.status !== "open" || !v.doc) return false;
    markupTool.finishText();
    if (t.kind !== "pdf") {
      notify("Markups can't be saved into an image yet");
      return false;
    }
    const dir = t.path.replace(/[\\/][^\\/]*$/, "");
    const dest = await pickSavePdf(`${dir}\\${copyName(t.path)}`, "Save a copy with markups");
    if (!dest) return false;
    if (pathKey(dest) === pathKey(t.path)) return saveActive();
    // Stamps: the copy asks too; the signatures stay movable here either way.
    const bake = await askBake(t, true);
    if (!bake) return false;
    try {
      if (t.marks.reading) await t.marks.reading; // Existing annotations
      await ensureFrames(t, v.doc.docId);
      const p = await invoke<Prepared>("annot_prepare", { path: t.path, password: t.password, changes: saveChanges(t, bake), target: dest, expect: null });
      await invoke("annot_commit", { temp: p.temp, target: p.target });
      notify(`Saved a copy as ${fileName(dest)}`);
      return true;
    } catch (e) {
      console.warn("save a copy failed:", String((e as Error)?.message ?? e));
      notify(userMessage(e, "save the copy"));
      return false;
    }
  }

  // ---------------------------------------------------------------- unsaved work

  const dirtyTabs = () => tabs.tabs.filter((t) => t.marks.dirty);

  /** Before a tab closes: save, discard or cancel. True to go ahead. */
  async function settleTab(t: Tab): Promise<boolean> {
    if (!t.marks.dirty) return true;
    if (t.id !== tabs.activeId) await activate(t.id);
    const a = await ask("Unsaved markups", unsavedMessage([t.title]), ["Save", "Don't save", "Cancel"]);
    if (a === "Save") return saveActive();
    if (a === "Don't save") {
      invoke("recovery_delete", { key: recoveryKey(pathKey(t.path)) }).catch(() => {});
      return true;
    }
    return false;
  }

  /** Before Vellum closes (window close, update): save, discard or cancel. True to go ahead. */
  async function settleAll(): Promise<boolean> {
    const dirty = dirtyTabs();
    if (!dirty.length) return true;
    const a = await ask("Unsaved markups", unsavedMessage(dirty.map((t) => t.title)), [dirty.length > 1 ? "Save all" : "Save", "Don't save", "Cancel"]);
    if (a === "Don't save") {
      for (const t of dirty) await invoke("recovery_delete", { key: recoveryKey(pathKey(t.path)) }).catch(() => {});
      return true;
    }
    if (a !== "Save" && a !== "Save all") return false;
    for (const t of dirty) {
      await activate(t.id);
      if (!(await saveActive())) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- crash recovery

  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  /** A second after a change, keep the active tab's unsaved markups where a crash can't lose them. */
  function scheduleRecovery() {
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      const t = active;
      if (!t || t.kind !== "pdf" || t.status !== "open") return;
      const key = recoveryKey(pathKey(t.path));
      if (!t.marks.dirty) {
        invoke("recovery_delete", { key }).catch(() => {});
        return;
      }
      const json = JSON.stringify({ v: 1, path: t.path, stamp: t.stamp, markups: t.marks.markups, saved: t.marks.saved.map((m) => m.id) });
      invoke("recovery_write", { key, json }).catch((e) => console.warn("recovery write failed:", String(e)));
    }, 1000);
  }

  /** After opening a PDF: note its stamp, and offer back markups a crash left unsaved. */
  async function afterOpenMarkups(id: number) {
    const t = tabById(id);
    if (!t || t.kind !== "pdf") return;
    const stamp = await invoke<Stamp>("file_stamp", { path: t.path }).catch(() => null);
    updateTab(id, { stamp });
    // Existing annotations: read the file's own, in the background.
    t.marks.author = settings.markup.author ?? author;
    const reading = readFileAnnots(t);
    const key = recoveryKey(pathKey(t.path));
    const raw = await invoke<string | null>("recovery_read", { key }).catch(() => null);
    if (!raw) return;
    let rec: { stamp: Stamp | null; markups: Markup[]; saved: string[] } | null = null;
    try {
      rec = JSON.parse(raw);
    } catch {
      rec = null;
    }
    const same = rec && stamp && rec.stamp && rec.stamp.size === stamp.size && rec.stamp.mtimeMs === stamp.mtimeMs;
    if (!rec || !same || !Array.isArray(rec.markups)) {
      // The file changed since (or the record is unreadable): the markups may not fit it any more.
      invoke("recovery_delete", { key }).catch(() => {});
      return;
    }
    const a = await ask("Unsaved markups", `Vellum closed before your markups on ${t.title} were saved. Restore them?`, ["Restore", "Discard"]);
    if (a !== "Restore") {
      invoke("recovery_delete", { key }).catch(() => {});
      return;
    }
    await reading;
    const now = tabById(id);
    const v = viewer;
    if (!now || !v?.doc || now.id !== tabs.activeId) return;
    // Existing annotations: with the file read, what it holds is known; the record's markups
    // (the file's own by the same ids) become the present, and anything changed is lifted.
    if (now.marks.read) {
      now.marks.history.push(rec.markups);
      markupTool?.attach(now.marks);
      liftNow();
      markVersion++;
      return;
    }
    const savedIds = new Set(rec.saved);
    now.marks.saved = rec.markups.filter((m) => savedIds.has(m.id));
    now.marks.history.push(rec.markups);
    const byPage = new Map<number, string[]>();
    for (const m of now.marks.saved) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m.id]);
    for (const [page, nms] of byPage) await invoke("doc_hide_annots", { docId: v.doc.docId, page, nms, hidden: true }).catch(() => {});
    v.dropTiles();
    markupTool?.attach(now.marks);
    markVersion++;
  }

  // ---------------------------------------------------------------- existing annotations (phase 7b)

  /**
   * Read the file's annotations into the tab's markups (annot_read: straight from the file, off
   * the render workers), with the pictures of any image stamps Vellum wrote. In the background:
   * nothing waits for it but a crash-recovery restore and a save.
   */
  function readFileAnnots(t: Tab): Promise<void> {
    const marks = t.marks;
    const { path, password } = t;
    const run: Promise<void> = (async () => {
      const r = await invoke<AnnotRead>("annot_read", { path, password });
      // One set of ids for the whole file: an /NM used on two pages gets an id of its own the second time.
      const used = new Set<string>();
      let list = r.pages.flatMap((p) => fromFile(p, used));
      const hashes = stampHashes(list.map((x) => x.markup));
      if (hashes.length) {
        const pngs = await invoke<Record<string, string>>("annot_stamp_images", { path, password, hashes }).catch(() => ({}));
        const ms = withStampImages(list.map((x) => x.markup), pngs);
        list = list.map((x, i) => ({ ...x, markup: ms[i] }));
      }
      if (!tabs.tabs.some((x) => x.marks === marks)) return; // closed meanwhile
      marks.adoptFile(list);
      if (active?.marks === marks) {
        liftNow();
        viewer?.requestFrame();
      }
      markVersion++;
    })()
      .catch((e) => console.warn("reading the file's annotations failed:", String((e as Error)?.message ?? e)))
      .finally(() => {
        if (marks.reading === run) marks.reading = null;
      });
    marks.reading = run;
    return run;
  }

  /** After a save: read the file again for where each annotation now sits (MarkupDoc.reread). */
  function rereadFileAnnots(t: Tab): Promise<void> {
    const marks = t.marks;
    const run: Promise<void> = invoke<AnnotRead>("annot_read", { path: t.path, password: t.password })
      .then((r) => {
        marks.reread(r.pages);
        if (active?.marks === marks) liftNow();
        markVersion++;
      })
      .catch((e) => console.warn("reading the file's annotations again failed:", String((e as Error)?.message ?? e)))
      .finally(() => {
        if (marks.reading === run) marks.reading = null;
      });
    marks.reading = run;
    return run;
  }

  let liftChain: Promise<void> = Promise.resolve();
  /**
   * Hide in PDFium the annotations from the file the overlay now draws instead (with `ids`,
   * those a drag is starting on; otherwise any that changed or went), then re-render those
   * pages: the active tab only, whose document is the one open on the canvas.
   */
  function liftNow(ids?: string[]) {
    const t = active;
    const v = viewer;
    if (!t || t.status !== "open" || t.kind !== "pdf" || !v?.doc || markupTool?.doc !== t.marks) return;
    const groups = t.marks.toLift(ids);
    if (!groups.length) return;
    const docId = v.doc.docId;
    liftChain = liftChain.then(async () => {
      for (const g of groups) {
        await invoke("doc_hide_annots", { docId, page: g.page, nms: g.nms, indices: g.indices, hidden: true }).catch((e) => console.warn("hiding an annotation failed:", String(e)));
        if (viewer?.doc?.docId === docId) viewer.dropPageTiles(g.page);
      }
    });
  }

  /** The padlock: unlock "Edit document" (saying so first if the file is signed or asks not to be changed), or lock it again. */
  async function toggleEditLock() {
    const t = active;
    if (!t || t.status !== "open" || t.kind !== "pdf") return;
    const marks = t.marks;
    if (marks.unlocked) {
      marks.unlocked = false;
      for (const id of [...marks.selection]) {
        const m = marks.byId(id);
        if (m && !marks.editable(m)) marks.selection.delete(id);
      }
      markVersion++;
      viewer?.requestFrame();
      return;
    }
    const info = await invoke<FileInfo>("annot_inspect", { path: t.path, password: t.password }).catch(() => null);
    const warnings = unlockWarnings(t.title, info);
    if (warnings.length) {
      const a = await ask("Edit file", "Unlock to move, restyle and delete the annotations that came with the file?", ["Unlock", "Cancel"], { warnings });
      if (a !== "Unlock") return;
    }
    if (active !== t) return;
    marks.unlocked = true;
    markVersion++;
    viewer?.requestFrame();
  }

  const unlockedNow = $derived.by(() => {
    void markVersion;
    return !!markupTool?.doc?.unlocked;
  });

  const active = $derived(activeTab(tabs));
  const hasDoc = $derived(!!active && active.status === "open" && ui.docId !== null);
  /** A PDF is showing: search, selection and links apply (images have no text). */
  const textDoc = $derived(hasDoc && ui.kind === "pdf");
  /** A PDF is showing: markups can be drawn and saved (not into images, yet). */
  const pdfDoc = $derived(hasDoc && ui.kind === "pdf");
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
      password: null, token: 0, marks: new MarkupDoc(), stamp: null,
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
      readingFollowsDoc();
    } else if (t.status === "pending") {
      readingFollowsDoc();
      await load(id, t.password ?? undefined);
    } else {
      v.close(); // error or password tab: nothing on the canvas
      setTitle(t.title);
      readingFollowsDoc();
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
    readingFollowsDoc();
    void afterOpenMarkups(id);
    settings.recent = addRecent(settings.recent, t.path);
    save();
    detectScale(id, info);
  }

  async function closeTab(id: number) {
    const v = viewer;
    const first = tabById(id);
    if (!v || !first) return;
    if (!(await settleTab(first))) return;
    const t = tabById(id);
    if (!t) return;
    if (passwordFor?.tabId === id) passwordFor = null;
    const wasActive = id === tabs.activeId;
    if (wasActive && t.status === "open") rememberActive();
    const closingDoc = wasActive ? (v.doc?.docId ?? null) : (t.info?.docId ?? null);
    if (closingDoc !== null) {
      textTool?.forgetDoc(closingDoc);
      search?.forgetDoc(closingDoc);
    }
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
    if (!(await settleAll())) return false;
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
    void markVersion;
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
          { label: "Save", shortcut: "Ctrl+S", disabled: !pdfDoc || !active?.marks.dirty, action: () => void saveActive() },
          { label: "Save a copy…", shortcut: "Ctrl+Shift+S", disabled: !pdfDoc, action: () => void saveCopy() },
          { separator: true },
          docItem("Print…", openPrint, "Ctrl+P"),
          docItem("Document properties", () => (dialog = "properties"), "Ctrl+D"),
          { separator: true },
          { label: "Close tab", shortcut: "Ctrl+W", disabled: !active, action: () => active && closeTab(active.id) },
        ],
      },
      {
        label: "Edit",
        items: [
          { label: "Undo", shortcut: "Ctrl+Z", disabled: !markupTool?.drawingPoints && !markupTool?.doc?.history.canUndo, action: () => (markupTool?.drawingPoints ? markupTool.removeLastPoint() : markupTool?.undo()) },
          { label: "Redo", shortcut: "Ctrl+Y", disabled: !markupTool?.doc?.history.canRedo, action: () => markupTool?.redo() },
          { separator: true },
          { label: "Cut markups", shortcut: "Ctrl+X", disabled: !markupTool?.hasSelection, action: () => markupTool?.cut() },
          { label: "Copy", shortcut: "Ctrl+C", disabled: !textUi.hasSelection && !markupTool?.hasSelection, action: () => (markupTool?.hasSelection ? markupTool.copy() : copySelection()) },
          { label: "Paste", shortcut: "Ctrl+V", disabled: !pdfDoc || !markupTool?.canPaste, action: () => void markupTool?.paste("centre") },
          { label: "Delete markups", shortcut: "Delete", disabled: !markupTool?.hasSelection, action: () => markupTool?.deleteSelection() },
          // Existing annotations
          { label: unlockedNow ? "Lock file" : "Unlock file…", disabled: !pdfDoc, action: () => void toggleEditLock() },
          { separator: true },
          { label: "Select all markups on the page", shortcut: markupTool?.hasSelection || toolNow !== "select" ? "Ctrl+A" : undefined, disabled: !pdfDoc, action: selectAllMarkups },
          { label: "Select all text on the page", shortcut: markupTool?.hasSelection || toolNow !== "select" ? undefined : "Ctrl+A", disabled: !textDoc, action: () => textTool?.selectPage(ui.page) },
          // Text markups
          { label: "Highlight text", shortcut: "Ctrl+H", disabled: !textUi.hasSelection || !pdfDoc, action: () => void markText("highlight") },
          { label: "Underline text", shortcut: "Ctrl+U", disabled: !textUi.hasSelection || !pdfDoc, action: () => void markText("underline") },
          { label: "Strike through text", shortcut: "Ctrl+Shift+X", disabled: !textUi.hasSelection || !pdfDoc, action: () => void markText("strike") },
          { separator: true },
          { label: "Find…", shortcut: "Ctrl+F", disabled: !textDoc, action: () => searchField?.focus() },
          { label: "Find next", shortcut: "F3", disabled: !searchView?.hits.length, action: () => search?.step(1) },
          { label: "Find previous", shortcut: "Shift+F3", disabled: !searchView?.hits.length, action: () => search?.step(-1) },
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
            // Paper sizes, the read-outs, and the units measurements set to Auto are written in
            // (tool consistency stage 10).
            label: "Units for sizes and measurements",
            submenu: [
              { label: "Metric: millimetres and metres", radio: true, checked: settings.units === "metric", action: () => { settings.units = "metric"; save(); } },
              { label: "Imperial: feet and inches", radio: true, checked: settings.units === "imperial", action: () => { settings.units = "imperial"; save(); } },
            ],
          },
          { separator: true },
          { label: "Performance overlay", shortcut: "F12", checked: debug, action: () => (debug = !debug) },
        ],
      },
      {
        label: "Document",
        items: [
          docItem("Rotate view clockwise", () => v?.rotate(1), "]"),
          docItem("Rotate view anticlockwise", () => v?.rotate(-1), "["),
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

  /** Stage 9: select the current page's markups (in Select: a drawing tool's selection is only what it drew). */
  function selectAllMarkups() {
    const mt = markupTool;
    if (!mt || !pdfDoc) return;
    if (mt.tool !== "select") setTool("select");
    textTool?.clear();
    mt.selectAllOnPage(ui.page);
  }

  // ------------------------------------------------------------------ keyboard (shell-level; navigation keys live in input.ts)

  /** A modal (a dialog, or the print dialog unless it's hidden for an area pick) owns the keyboard. */
  const modalOpen = $derived(dialog !== null || choice !== null || (printOpen && !marquee));

  // WebView2's own accelerators (reload, find, save page...) don't belong here. Capture phase,
  // so it runs before a dialog or menu can stop the key.
  function guardWebView(e: KeyboardEvent) {
    if (isWebViewAccelerator(e)) e.preventDefault();
  }

  function onKeyDown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (marquee || modalOpen) return;
    // Find is ours, though it's also one of WebView2's accelerators (guardWebView stops that).
    if (ctrl && !e.shiftKey && !e.altKey && k === "f") {
      if (textDoc) searchField?.focus();
      e.preventDefault();
      return;
    }
    // Save is ours too (Ctrl+S is also a WebView2 accelerator).
    if (ctrl && !e.altKey && k === "s") {
      e.preventDefault();
      if (!e.repeat && pdfDoc) void (e.shiftKey ? saveCopy() : saveActive());
      return;
    }
    if (e.key === "F3" && !ctrl) {
      search?.step(e.shiftKey ? -1 : 1);
      e.preventDefault();
      return;
    }
    if (isWebViewAccelerator(e) || blockedWhileTyping(e)) return;
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
    } else if (ctrl && !e.shiftKey && k === "z" && !isTyping(e)) {
      // While a shape is being clicked out, undo takes back its last point.
      if (markupTool?.drawingPoints) markupTool.removeLastPoint();
      else markupTool?.undo();
    } else if (ctrl && (k === "y" || (e.shiftKey && k === "z")) && !isTyping(e)) {
      markupTool?.redo();
    } else if (ctrl && !e.shiftKey && k === "c" && !isTyping(e)) {
      if (markupTool?.hasSelection) markupTool.copy();
      else if (textUi.hasSelection) copySelection();
      else handled = false;
    } else if (ctrl && !e.shiftKey && k === "x" && !isTyping(e)) {
      if (!markupTool?.cut()) handled = false;
    } else if (ctrl && !e.shiftKey && k === "v" && !isTyping(e)) {
      // Whatever was copied last, anywhere: markups (at the pointer) or a picture.
      if (pdfDoc && markupTool) void markupTool.paste("pointer");
      else handled = false;
    } else if (e.key === "Backspace" && !isTyping(e) && markupTool?.drawingPoints) {
      markupTool.removeLastPoint();
    } else if ((e.key === "Delete" || e.key === "Backspace") && !isTyping(e)) {
      if (!markupTool?.deleteSelection()) handled = false;
    } else if (e.key.startsWith("Arrow") && !ctrl && !isTyping(e) && markupTool?.hasSelection) {
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
      markupTool.nudge(d[0], d[1]);
    } else if (e.key === "Enter" && !isTyping(e) && markupTool?.drawingPoints) {
      markupTool.finishPoints(true);
    } else if ((e.key === "Escape" || e.key === "Enter") && !isTyping(e) && markupTool?.cropping) {
      // Cropping: Enter or Esc finishes (each drag was already its own undo step).
      markupTool.setCropping(false);
    } else if (e.key === "Escape" && !isTyping(e) && markupTool && (markupTool.drawingPoints || markupTool.tool !== "select" || markupTool.hasSelection)) {
      if (markupTool.drawingPoints) markupTool.finishPoints(false);
      else if (markupTool.tool !== "select") markupTool.setTool("select");
      else markupTool.clearSelection();
    } else if (!ctrl && !e.altKey && !e.shiftKey && k === "h" && !isTyping(e) && textUi.hasSelection && pdfDoc) {
      // H with text selected highlights it, rather than picking the Highlighter.
      void markText("highlight");
    } else if (!ctrl && !e.altKey && !isTyping(e) && markupTool && toolForKey(k, markupTool.tool) !== null) {
      // A tool's letter: its last used, again for the next sharing it, Shift for the one before
      // (rule 8, markup/tools.ts).
      if (pdfDoc) setTool(toolForKey(k, markupTool.tool, settings.markup.lastForKey, e.shiftKey)!);
    } else if (ctrl && !e.shiftKey && k === "a" && !isTyping(e)) {
      // Never the WebView's select-all, which would highlight the whole shell. With a markup
      // selected or a markup tool out, the page's markups; otherwise the page's text.
      if (pdfDoc && markupTool && (markupTool.hasSelection || markupTool.tool !== "select")) selectAllMarkups();
      else if (textDoc) textTool?.selectPage(ui.page);
    } else if (e.key === "Escape" && !isTyping(e) && textUi.hasSelection) {
      textTool?.clear();
    } else if (e.key === "F1") {
      dialog = "shortcuts";
    } else if (ctrl && e.shiftKey && !e.altKey && /^Digit[123]$/.test(e.code)) {
      // By the physical key: on a UK keyboard Shift+2 types a quotation mark.
      if (hasDoc) setLayout(e.code === "Digit1" ? "single" : e.code === "Digit2" ? "continuous" : "columns");
    } else if (!ctrl && !e.altKey && !e.shiftKey && k === "n") {
      if (hasDoc) setNav(ui.navMode === "cad" ? "document" : "cad");
    } else if (!ctrl && !e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight") && !isTyping(e)) {
      // By the physical key (Shift+[ types a brace). A stamp about to be placed, or a selection
      // that can turn, turns a quarter (Shift: 15 degrees); a selection that can't turn stays
      // put. Otherwise the view turns (was R, which is now the Rectangle's).
      const cw = e.code === "BracketRight";
      if (hasDoc && !markupTool?.turnBy((cw ? 1 : -1) * (e.shiftKey ? 15 : 90))) viewer?.rotate(cw ? 1 : -1);
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
      const tt = new TextTool(v, { openUrl: followUrl, onChange: refreshText });
      textTool = tt;
      const mt = new MarkupTool(v, {
        styleFor: (_k, tool) => styleFor(settings.markup, tool),
        textStyle: (tool) => textFor(settings.markup, tool),
        author: () => settings.markup.author ?? author,
        onChange: onMarkupsChanged,
        onLift: (ids) => liftNow(ids), // Existing annotations
        // Stage 9: markups go on the system clipboard in Vellum's own format (src-tauri/src/clipboard.rs).
        clipboard: {
          write: (json) => invoke<void>("clipboard_put_markups", { json }),
          read: () => invoke<ClipRead>("clipboard_take").catch((e) => {
            console.warn("paste: clipboard read failed:", String(e));
            return { kind: "none" } as const;
          }),
        },
        notify,
        sides: (tool) => sidesFor(settings.markup, tool), // Stage 6
        // Stage 8: a picture pasted from the clipboard becomes an Image markup, upright as viewed.
        onPicture: (pic, page, at) => void placePicture(pic, page, at),
        placedOnce: () => setTool("select"), // the Image tool places one picture
      });
      markupTool = mt;
      // With --debug, scripted checks (DevTools) can reach the engine. Never in a normal launch.
      if (args.debug) (window as unknown as { __vellum: unknown }).__vellum = { viewer: v, markupTool: mt, textTool: tt, tabs: () => tabs };
      invoke<string>("user_display_name")
        .then((n) => {
          author = n;
          // Existing annotations: the lock leaves your own markups free.
          for (const t of tabs.tabs) t.marks.author = settings.markup.author ?? n;
          markVersion++;
        })
        .catch(() => {});
      // Closing the window: settle unsaved markups first (the title bar's close calls close()).
      win
        .onCloseRequested(async (ev) => {
          if (!dirtyTabs().length) {
            rememberActive();
            return;
          }
          ev.preventDefault();
          if (await settleAll()) {
            rememberActive();
            await win.destroy();
          }
        })
        .then((un) => cleanups.push(un))
        .catch(() => {});
      search = new SearchController(v, refreshSearch);
      detachInput = attachInput(host, v, {
        open: openDialog,
        toggleDebug: () => (debug = !debug),
        blocked: () => modalOpen,
        hasDoc: () => hasDoc,
        // Markups first (handles, markups, drawing tools), then text and links, then a marquee.
        left: {
          down: (x, y, clicks, mods) => {
            if (pdfDoc && mt.down(x, y, clicks, mods)) return true;
            if (textDoc && mt.tool === "select" && tt.pointerDown(x, y, clicks)) return true;
            return pdfDoc && mt.marqueeDown(x, y, mods);
          },
          move: (x, y, mods) => {
            if (mt.active) mt.move(x, y, mods);
            else if (tt.active) tt.pointerMove(x, y);
            else {
              if (pdfDoc) mt.move(x, y, mods);
              if (textDoc && mt.tool === "select") tt.pointerMove(x, y);
            }
          },
          up: (x, y, mods) => {
            if (mt.active) mt.up(x, y, mods);
            else tt.pointerUp();
          },
          leave: () => {
            tt.pointerLeave();
            mt.leave(); // a paste now goes to the middle of the view
          },
          cursor: () => (pdfDoc ? mt.cursor() : null) ?? (textDoc && mt.tool === "select" ? tt.cursor() : null),
        },
        contextMenu: (x, y) => {
          // Clicking out a shape: finish it, take back a point, or cancel, by mouse.
          if (mt.drawingPoints) {
            contextMenu = {
              x, y,
              items: [
                { label: "Finish", shortcut: "Enter", disabled: !mt.canFinishPoints, action: () => mt.finishPoints(true) },
                { label: "Remove last point", shortcut: "Backspace", action: () => mt.removeLastPoint() },
                { label: "Cancel", shortcut: "Esc", action: () => mt.finishPoints(false) },
              ],
            };
            return;
          }
          // Stage 6: on a selected shape's corner, remove it (never below the fewest it takes).
          const hr = host.getBoundingClientRect(); // client to canvas coordinates, as input.ts gives the left button
          const corner = mt.cornerAt(x - hr.left, y - hr.top);
          const cornerItems: MenuItem[] = corner ? [{ label: "Remove corner", disabled: !corner.removable, action: () => mt.removeCorner(corner.id, corner.index) }] : [];
          // One picture selected: put another in its place (same middle, width and turn).
          const sel = mt.tool === "select" ? mt.selected() : [];
          const pic = sel.length === 1 && sel[0].kind === "stamp" && sel[0].content.type === "image" && !sel[0].signature;
          if (pic) cornerItems.push({ label: "Replace picture…", action: () => void choosePicture(true) });
          // A placed stamp or signature: the grid at the pointer, to swap what it holds (same place, size and turn).
          const st = sel.length === 1 && sel[0].kind === "stamp" && !pic ? sel[0] : null;
          if (st) {
            const family: StampFamily = st.signature ? "signature" : "stamp";
            cornerItems.push({ label: st.signature ? "Replace signature…" : "Replace stamp…", action: () => (stampGrid = { family, replace: true, at: { x, y } }) });
          }
          // Measuring: the rare case of every measurement in the file taking one's units and decimals.
          const m = mt.tool === "select" ? mt.selected().find(isMeasurement) : undefined;
          if (m) {
            contextMenu = { x, y, items: [...cornerItems, { label: "Apply its units and decimals to all measurements", action: () => formatAllLike(m.fmt) }] };
            return;
          }
          if (cornerItems.length) {
            contextMenu = { x, y, items: cornerItems };
            return;
          }
          if (!tt.hasSelection) return;
          contextMenu = { items: [{ label: "Copy", shortcut: "Ctrl+C", action: copySelection }], x, y };
        },
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
      dirty: (void markVersion, t.marks.dirty),
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
    return cursorText(c.x, c.y, s.h, pageMeasure(active, c.page).ratio, settings.units); // Measuring: the page's own scale
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
    >
      {#snippet centre()}
        <ToolPalette
          tool={toolNow}
          disabled={!pdfDoc}
          disabledReason={hasDoc && !pdfDoc ? "Markups on images come later (they can't be saved into an image)" : undefined}
          lastInGroup={settings.markup.lastInGroup}
          onTool={setTool}
        />
      {/snippet}
      {#snippet lock()}
        <EditLock unlocked={unlockedNow} disabled={!pdfDoc} onToggle={() => void toggleEditLock()} />
      {/snippet}
      {#snippet searchBox()}
        <SearchField
          bind:this={searchField}
          disabled={!textDoc}
          view={searchView}
          docKey={ui.docId}
          matchCase={searchOpts.matchCase}
          wholeWord={searchOpts.wholeWord}
          onSearch={runSearch}
          onStep={(d) => search?.step(d)}
          onSelect={(i) => search?.select(i)}
          onOption={toggleSearchOption}
        />
      {/snippet}
    </Toolbar>

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
        markups={markupsTab}
        onPickMarkup={pickMarkup}
        onDeleteMarkup={(id) => markupTool?.removeMarkup(id)}
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
      {#if chrome && strip}
        <!-- Floats over the top of the canvas: showing or hiding it never resizes the canvas,
             so the drawing doesn't move under the pointer. -->
        <PropertiesStrip
          bar={strip.bar} kinds={strip.kinds} style={strip.style} text={strip.text} label={strip.label}
          {...measureStrip}
          sides={strip.sides} onSides={stripSides}
          {...dimensionStrip}
          dock={liveDock ?? settings.markup.dock} areaW={stageW} areaH={stageH}
          onStyle={stripStyle} onText={stripText}
          crop={cropStrip}
          dateLine={dateLineStrip}
          swap={swapStrip}
          onDock={(d, done) => {
            liveDock = done ? null : d;
            if (done) {
              settings.markup = { ...settings.markup, dock: d };
              save();
            }
          }}
        />
      {/if}
      {#if editor}
        {#key editor.id}
          <TextEditor
            x={editor.x} y={editor.y} w={editor.w} h={editor.h} rotation={editor.rotation} scale={editor.scale}
            textStyle={editor.textStyle} pad={editor.pad} text={editor.text}
            onInput={(s) => markupTool?.setText(s)}
            onDone={() => markupTool?.finishText()}
          />
        {/key}
      {/if}
      <!-- Measuring -->
      {#if measuring && hasDoc}
        <Loupe />
      {/if}
      {#if calib && active?.info && calib.tabId === active.id}
        <CalibrateDialog
          paperMm={calib.paperMm} page={calib.page + 1} numPages={active.info.numPages} current={pageMeasure(active, calib.page).ratio}
          onApply={applyCalibration} onClose={calibrationDone} units={settings.units}
        />
      {/if}
      <!-- End measuring -->
      <!-- Stamps -->
      <!-- Text markups -->
      {#if chrome && selBar}
        <SelectionBar x={selBar.x} y={selBar.y} areaW={stageW} areaH={stageH} onMark={(v) => void markText(v)} onCopy={() => void copySelection()} />
      {/if}
      {#if viewer && noteTool && pdfDoc}
        <NoteLayer {viewer} markupTool={noteTool} version={markVersion} view={[ui.viewWorld.x, ui.viewWorld.y, ui.zoom, ui.rotation]} tool={toolNow} areaW={stageW} areaH={stageH} />
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
      scaleText={hasDoc ? scaleStatusText(active?.scale ?? null, settings.units) : null}
      hint={hasDoc ? textUi.link || navHint(ui.navMode) : ""}
      {notice}
      cursor={cursorLabel}
      pageSize={pageSizeLabel}
      onScale={openScale}
      {...measureBar}
    />
  {/if}
</div>

{#if contextMenu}
  <MenuPopup items={contextMenu.items} x={contextMenu.x} y={contextMenu.y} onClose={() => (contextMenu = null)} />
  <div class="ctx-catch" role="presentation" onpointerdown={() => (contextMenu = null)} oncontextmenu={(e) => { e.preventDefault(); contextMenu = null; }}></div>
{/if}

<!-- Stamps. The grid and Manage stamps sit outside the drawing area, so the pointer over them
     isn't over the drawing (no placing preview under them, no crosshair). -->
{#if stampsDialog}
  <StampsDialog
    prefs={settings.stamps}
    {fieldValue}
    onPrefs={(prefs) => {
      settings.stamps = prefs;
      save();
    }}
    onClose={() => (stampsDialog = false)}
  />
{/if}
{#if stampGrid}
  {@const g = stampGrid}
  {@const a = g.replace ? null : stampArmed[g.family]}
  {#key g}
    <StampGrid
      family={g.family} at={g.at ?? null} from={g.from ?? null} out={g.out ?? "down"}
      current={g.replace ? replacing : (a?.content ?? null)} currentId={a?.id ?? null}
      lineLabel={g.family !== "stamp" ? null : gridLineLabel(g.replace ? replacing : (a?.content ?? null))}
      lineOf={(label) => lineOf(settings.stamps, label)} onLine={setLineFor} defaultLine={settings.stamps.line}
      preview={(c) => filledStamp(c, fieldValues(viewer?.currentPageIndex ?? null))} {fieldValue}
      texts={settings.stamps.texts}
      onPick={gridPicked} onPickSignature={gridPickedSignature}
      onAddText={addOwnText}
      onNewSignature={() => (signaturesDialog = "pad")}
      onManage={() => manageStamps(g.family)}
      onClose={() => (stampGrid = null)}
    />
  {/key}
{/if}
{#if signaturesDialog}
  <SignaturesDialog
    start={signaturesDialog}
    armedId={stampArmed.signature?.id ?? null}
    onSaved={newSignatureSaved}
    onDeleted={signatureDeleted}
    onClose={() => (signaturesDialog = null)}
  />
{/if}

{#if choice}
  <ChoiceDialog title={choice.title} message={choice.message} warnings={choice.warnings} note={choice.note} choices={choice.choices} onCancel={choice.onCancel} />
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
  <ScaleDialog fileName={active.title} current={active.scale} candidates={active.candidates} onApply={applyScale} onClose={() => (dialog = null)} {...measureScaleDialog} units={settings.units} />
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
