# Phase 1, reading part one: scope

Status: **built, waiting for Matt's check** (13 November 2026). Phase 1 of [editing-scope.md](editing-scope.md):
search, text selection and copy, links. No save path. Working autonomously (Matt's call);
decisions not in the brief are recorded under "Assumed" for Matt to correct in one pass.

## Objective

Ctrl+F searches the whole document in the background, with hits highlighted on the page and
listed in a card under the search box; left drag selects text and Ctrl+C copies it; links in the file (and
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
- UI: a search field at the right of the toolbar with a results card under it, Edit menu
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
`StatusBar.svelte`, `App.svelte`, shortcuts.

## Steps

1. Backend: frame conversion (tested), text layer, links, page search, open_url.
2. Pure text logic with tests.
3. Viewer highlight layers and revealRect; textTool; input routing.
4. Search session; toolbar field and results card; menus and shortcuts; status bar.
5. Tests, `npm run check`, cargo tests, release build, run it on the synthetic files.

## Progress

- Merged `main` (the release pipeline, 0.1.1) into `editing` first, as the brief says, while
  this branch had no app changes: no conflicts.
- Step 1 done: `text.rs` (frame, text layer, links, page search), `open_url`; cargo tests in
  `tests/text.rs` (boxes land on the rendered ink at every rotation and with an offset crop
  box; links; search options) and `tests/shell.rs` (which URLs are followed).
- Steps 2 to 4 done: `src/lib/text/` (Vitest), `view/reveal.ts`, viewer highlights,
  `engine/textTool.ts`, `engine/search.ts` (tested against a stub renderer in
  `engine/reading.test.ts`), search field, Edit menu, keys, status bar.
- Step 5 done: `npm run check` clean, `npm test` (all Vitest files) and the new cargo tests pass;
  release build run on the synthetic files and the aerial drawing (read-only) through a
  throwaway DevTools script: search, the count, F3 / Shift+F3, the results tab, the text cursor
  over text, Ctrl+A then Ctrl+C, a drag then Ctrl+C, Esc. No console errors, no panics.

## Measured (release build, this machine)

| File | Text layer, page 1 | Search, page 1 | Whole document |
|---|---|---|---|
| 1-a1-200k-lines (123 characters) | 50 ms cold, 7 ms after | 7 ms | instant |
| 2-a1-50k-text (300,000 characters, 6.3 MB layer) | 163 ms cold, 115 ms after | 81 ms | one page |
| 3-a3-40-pages | 29 ms | 4 ms | 40 pages in about 150 ms |
| 5-a4-300-pages | 5 ms | 6 ms | 300 pages in about 1.1 s |
| Aerial drawing (85,000 characters) | **6.3 s** the first time (queued behind the page's first render on the same worker), 64 ms after | 53 ms | one page |

## Known problems

1. **A text request waits for its worker.** Text layers and page searches run on the page's
   own worker so a parsed page is reused, but they queue behind that worker's renders. Right
   after opening the aerial drawing, the first text layer waited 6.3 s for the first render.
   Hover fetches wait for the viewer to be idle, so this mostly shows if you start a selection
   or a search while the first render is still going. Possible fix: send text jobs to whichever
   worker is free when the page's own one is busy (costs a second parse of the page).
2. **Links into a page use the page height, not its rotation** (as the bookmarks already do),
   so a link to a point on a rotated page lands at the right page but maybe the wrong height.
   Untested: none of the files here has internal links.
3. Selecting by dragging doesn't scroll the view when the pointer reaches the edge.
4. The text cursor and link hand only appear once the page's text layer has loaded (the pointer
   rests a quarter of a second on an idle viewer).

## Not verified (for Matt)

- How it looks and feels: the highlight colours on a busy drawing, the search box's place in the
  toolbar (it wraps when narrow), the I-beam and hand cursors.
- Clicking a real link: none of the test files has links. The command and the URL check are
  tested; opening the browser isn't.
- Selection by drag in the real app on text I aimed at: the script dragged where it could
  without knowing the view, and copied what it covered. Word and line selection are tested in
  Vitest only.
- Vertical text (CAD dimension text) selection: tested in Vitest, not by hand.

## Matt's first look (14 November 2026)

Changed on his feedback:

- The count and results moved out of the toolbar and the sidebar into a card under the search
  box (the inline count made the toolbar shift as it changed). The card stays open while you
  work; Esc in the box or its close button clears the search. No Search tab in the sidebar.
- Typing while a search ran could put the old query back: fixed (the box takes the query from
  the search only when the tab changes).
- The search box now sits inside its group like the zoom box; Fit page and Fit width joined the
  zoom group behind a divider.
- Selection bands reach halfway into the gap to the neighbouring line (at most half their
  height), or a quarter of their height with no line that close, and a tenth past their ends;
  overlaps are filled once. Search hits get a small fixed margin.

