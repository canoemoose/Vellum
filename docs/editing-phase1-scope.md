# Phase 1, reading part one: scope

Status: **in progress** (13 November 2026). Phase 1 of [editing-scope.md](editing-scope.md):
search, text selection and copy, links. No save path. Working autonomously (Matt's call);
decisions not in the brief are recorded under "Assumed" for Matt to correct in one pass.

## Objective

Ctrl+F searches the whole document in the background, with hits highlighted on the page and
listed in a sidebar tab; left drag selects text and Ctrl+C copies it; links in the file (and
web addresses written in its text) can be clicked. None of it may slow down opening or
rendering a heavy drawing.

## Design

### Backend (`src-tauri/src/text.rs`, commands in `lib.rs`, dispatch in `docs.rs`)

- **Coordinates.** PDFium reports text, link and search rectangles in PDF user space (y up,
  unrotated, from the page box's own origin). Vellum's page coordinates are the page as PDFium
  renders it: `/Rotate` applied, y down from the top-left. One pure, tested function converts
  between them (`text::PageFrame`), from the page's rotation and bounding box. This also
  fixes the known wrong scale-detection boxes on the aerial drawing (it is stored rotated).
- `doc_text_layer(docId, page)`: binary. Every character (code point, loose box in page
  points, generated flag) plus the page's links (annotation links and web addresses found in
  the text) as JSON at the end. One text-page load per call.
- `doc_search_page(docId, page, query, matchCase, wholeWord)`: hits on one page, each with its
  merged rectangles and a little context either side. PDFium's own search
  (`FPDFText_FindStart`), so ligatures and case folding behave as in Chrome.
- `open_url(url)`: http, https and mailto only, handed to the default browser.
- All three run on the page's own worker (`page % workers`, as small renders do), so a page
  parsed for rendering isn't parsed again; one page per job, so renders interleave.

### Front end

- `src/lib/text/` (pure, Vitest): parsing the text layer, hit-testing characters, words and
  lines, selection ranges to merged rectangles and to text, link hit-testing and the URL
  check, search hit ordering and next/previous.
- `src/lib/engine/textTool.ts` (Svelte-free): per-document cache of text layers (LRU), the
  selection, link hover and click, cursor; driven by `input.ts` for the left button.
- `src/lib/engine/search.ts` (Svelte-free): a background search session per document.
- `Viewer` gets highlight layers (`setHighlights`), drawn by the compositor on top of the tiles
  with a multiply blend so the drawing shows through, and `revealRect` to bring a hit into view.
- UI: a search field at the right of the toolbar, a Search tab in the sidebar, Edit menu
  (Copy, Select all, Find), link targets in the status bar.

## Behaviour

- **Left drag** on or near text selects it, across pages if you drag that far. Double-click
  selects a word, triple-click a line. A click elsewhere clears the selection. Middle drag and
  Space+drag still pan; nothing else about navigation changes.
- **Ctrl+C** copies the selection; **Ctrl+A** selects all text on the current page; **Esc**
  clears it. Right-click on a selection offers Copy.
- **Links:** the cursor becomes a hand and the status bar shows the target; a click (not a
  drag) follows it. Internal links jump to the page and position; web links open in the
  default browser.
- **Search:** Ctrl+F focuses the field. Typing searches after a short pause; Enter / F3 next,
  Shift+Enter / Shift+F3 previous; Esc clears. Match case and whole words are options. Results
  come in page by page, starting from the current page; the count shows "3 of 27".
- **Text layers are fetched lazily:** only when the pointer rests on a page while the viewer is
  idle, or when you start a selection there. Opening a file costs nothing extra.

## Assumed (Matt to correct)

1. No select tool or mode: left drag selects text, since left drag did nothing before. Phase 2's
   tools will take left drag over when one is active.
2. A selection only starts on or near text (within a few pixels); dragging on empty drawing
   does nothing (left free for phase 2's marquee).
3. Ctrl+A selects the current page's text, not the whole document.
4. Web links open in the default browser on a single click, with no confirmation; only http,
   https and mailto are followed (anything else, such as `file:` or `javascript:`, is ignored).
5. Going to a search hit centres it and, if it would be smaller than 8 px on screen, zooms in
   until its text is about 20 px high (otherwise hits on an A1 drawing at fit are invisible).
6. Search stops collecting after 5,000 hits and says so.
7. The search query and results are kept per tab while you switch tabs.
8. Copied text uses the line breaks PDFium infers between lines.

## Files in play

New: `src-tauri/src/text.rs`, `src-tauri/tests/text.rs`, `src/lib/text/*`,
`src/lib/engine/textTool.ts`, `src/lib/engine/search.ts`, `src/lib/components/SearchField.svelte`,
`src/lib/components/SearchResults.svelte`. Changed: `pdfium.rs`, `docs.rs`, `lib.rs`,
`viewer.ts`, `input.ts`, `render/types.ts`, `backendRenderer.ts`, `Toolbar.svelte`,
`Sidebar.svelte`, `StatusBar.svelte`, `App.svelte`, `settings.ts` (sidebar tab), shortcuts.

## Steps

1. Backend: frame conversion (tested), text layer, links, page search, open_url.
2. Pure text logic with tests.
3. Viewer highlight layers and revealRect; textTool; input routing.
4. Search session; toolbar field; sidebar tab; menus and shortcuts; status bar.
5. Tests, `npm run check`, cargo tests, release build, run it on the synthetic files.

## Progress

- (updated as steps land)
