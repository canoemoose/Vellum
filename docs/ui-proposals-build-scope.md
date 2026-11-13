# Building the UI review's proposals (scope)

Source of truth for what to build: `docs/ui-review.md`, sections "Proposals for Tiers 2 to 5" and
"Decided" (Matt's answers override the groups' recommendations). Drawings:
`docs/mockups/ui-proposals.html`. Started 12 November 2026, autonomous mode.

## Constraints
- Shared checkout with the UI-polish session's uncommitted work (`docs/ui-polish-scope.md`). Build on
  it; don't revert or restructure it. **No commits** (mixed files); flag at the end.
- UK English, sparing em-dashes in UI copy, ASCII log strings. Engine (`src/lib/engine`, `render`,
  `view`) stays Svelte-free; pure logic gets Vitest tests next to it.
- Matt checks visuals by eye; run `npm run check`, `npm test`, `cargo test` and the app for crashes.
- Dev server in Matt's Terminal tab "vellum dev"; F5 is blocked, so `touch src/main.ts` to reload.

## Steps (in order) and status
1. [x] **A. Tokens:** `--scrim`, `--shadow-pop`, `--shadow-modal`, `--paper`, `--print-margin` (teal at
   half strength); use in Dialog, PrintDialog, ManualLayout, MenuPopup; white manual thumbnails.
2. [x] **B. Buttons and fields:** global `.btn`/`.field` only; drop Print/Manual restyles; dialog
   fields 32 px; compact fields (toolbar boxes, print side panel, preset editor) at the page box's
   tighter size (~24 px); page and zoom boxes boxed, mono, focus ring, dimmed when disabled; lone
   Close primary (Export).
3. [x] **C. States:** `--press`; hover/pressed/disabled for every control; item-16 controls.
4. [x] **D. Selected state:** `.seg` pale teal + `--accent-text`, normal weight; sidebar toggle `.on`;
   manual sheet tabs; zoom presets as a menu with a tick (teal current value).
5. [x] **E. Close button:** `CloseButton.svelte`, two sizes; tooltips match accessible names.
6. [x] **F. Details:** toolbar sizes/icons (36 px toggle, 16 px icons at 1.5); Fit page / Fit width
   as icons (item 63); light mini map pale grey (item 21); cursors (25); debug overlay (26); status
   hint slot (27); tall-page thumbnails up to 2:1, wide pages 8 px margins (item 64).
7. [x] **G. Behaviour:** Auto navigation segment (34); layout order Single, Continuous, Columns, and
   disabled without a document (35); Mini map Automatic/Show/Hide (36); hide nav hint without a
   document (37); new files open Continuous (layout default).
8. [x] **H. Names:** the naming table plus decided names (Show in Explorer, Bookmarks, Properties in
   File only, On screen/Area, Paper/Sheet, "{file} - Vellum", Ctrl+O badge dropped).
9. [x] **J. Page ranges:** one parser for Export and Print; empty = all pages.
10. [x] **I. Errors:** codes from Rust, `shell/messages.ts`; "Couldn't"; cancelled wording, normal
    colour; missing-DLL message; password flow by code.
11. [x] **K. Help:** shortcuts dialog rows; Ctrl+2, Ctrl+Shift+1/2/3, N; status-bar hint wording;
    README.
12. [x] Final: check, tests, cargo test, run the app; update `docs/ui-review.md` statuses; summary.
    `npm run check` clean; Vitest 381 passed; `cargo test` all suites passed; the dev build rebuilt
    and the app starts. Not seen by eye: Matt to look.

## Done already (this session)
Tier 1 (items 1 to 8), the fixed accent, the app icon, items 65 (mini map blur) and 66 (mini map
rotation).

## Notes as work proceeds
- Error codes: rather than change every Rust error type, user-facing errors are strings
  "[code] detail" (`src-tauri/src/errcode.rs`); `src/lib/shell/messages.ts` maps them. Uncoded
  text is shown when it was written for people, otherwise "Couldn't {verb}." (tested).
- Margin lists: wording aligned only; merging the print dialog's (Custom) and the manual
  layout's (5/10/15 mm) lists needs a settings-model change. Left for Matt.
- Compact fields are 24 px, radius 4 (the page box's), per Matt's "tighter" answer.
- Thumbnails: wide pages take the sidebar less 32 px (not 16): the scrollbar gutters and the
  selection outline need the room.
- A failed "Show in Explorer" now says so in the status bar (new short-lived notice there).
