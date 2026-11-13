# UI review: oddities and inconsistencies (12 November 2026)

Read-only review of every component, in three passes: visual consistency, words and conventions,
and whether actions, shortcuts and menus agree. Findings were spot-checked against the code;
anything that depends on runtime behaviour is marked *(runtime, not checked)*. Paths are under
`src/` unless they say otherwise. Ranked within each tier, most important first.

**Status (12 November 2026, late):** everything is built. Tier 1 is fixed (see "Tier 1: what was
fixed"); the accent is fixed at Deep teal and the app has its own icon; and every proposal for
Tiers 2 to 5 is built as decided (see "Decided" at the end, and `docs/ui-proposals-build-scope.md`
for how and what was left). Built and tested, not yet looked at by Matt. Line numbers below are
from the original review and may have moved.

## Tier 1: bugs (keyboard routing and focus)

1. **F5 or Ctrl+R inside any dialog probably reloads the app and loses every tab.**
   `lib/components/Dialog.svelte:26` stops every key at the backdrop. The guard against
   WebView2's own shortcuts (`App.svelte:588`: F5, Ctrl+R/F/G/S/U/J/H) listens on the window,
   so it never sees them. *(runtime, not checked)* Fix: run that guard in the capture phase.
2. **With a menu open, Ctrl+letter shortcuts become type-ahead.**
   `lib/shell/menuNav.ts:115` treats Ctrl+P as "P" and moves the highlight. It stops the event,
   so the shortcut is lost, and the WebView2 guard never sees Ctrl+R/F/S. Fix: no type-ahead
   while Ctrl, Alt or Meta is held.
3. **The Print dialog doesn't block the keys behind it.** These all still act on the app
   (`PrintDialog.svelte:338`, `ManualLayout.svelte:848`, which only handle Escape):
   - R rotates the drawing.
   - PageUp/PageDown and +/- move and zoom it.
   - Ctrl+W closes the tab under the print job.
   - Ctrl+D and F1 open dialogs *underneath*: z-index 60 against the print dialog's 100.
   - Alt and F10 open an invisible menu that takes focus.

   Fix: stop key propagation as `Dialog.svelte` does, keeping Escape, and use one z-index scale
   for all modals.
4. **Keys fall through an open menu to the drawing.** +, -, PageDown, Ctrl+W and R act behind
   it (`MenuPopup.svelte:68`). Fix: a menu swallows keys it doesn't use, or closes first.
5. **Every dialog focuses its close X first**, so the Password dialog doesn't focus its field,
   and keyboard-opened dialogs show a focus ring on the X. The cause is that `querySelector` on
   a selector list returns the first match in document order (`Dialog.svelte:20`). Fix: look
   in the body first.
6. **The typing check differs between the two key handlers.**
   - `input.ts:130` misses TEXTAREA.
   - `App.svelte:584` only guards R.
   - With the page box focused, Ctrl+0 does nothing but Ctrl+W still fires.

   Fix: one shared `isTyping(e)`. Ctrl and F-key shortcuts work everywhere; bare keys are
   blocked while typing.
7. **Holding Ctrl+W closes every tab; holding R spins the view.** There's no `e.repeat` check
   (`App.svelte:597`, `:607`).
8. **R, +, - and the page keys act with no document open,** while the same menu items are
   disabled (`App.svelte:607`, `input.ts:142-157`). Harmless, but inconsistent.

## Tier 2: visible inconsistencies

9. **The sidebar toggle never looks "on".** There's `class:on` but no CSS for it
   (`Toolbar.svelte:72`).
10. ~~**View > Accent never marks the current accent.**~~ *Gone: the Accent menu was removed when
    the accent became fixed.*
11. **Disabled inputs and selects aren't dimmed,** so the page and zoom boxes look live with
    no document, next to dimmed buttons (`app.css:76-98`).
12. **The Print and Manual layout dialogs restyle buttons their own way** (`PrintDialog.svelte:1170`,
    `ManualLayout.svelte:1427`). Footer buttons are 34 px against 32, the padding differs, and
    there's a brightness filter on hover. "Plain" buttons get **no hover at all**. Fix: use
    the global button styles.
13. **The page box and zoom box sit side by side but are styled differently:** 24 px against
    30, radius 4 against 6, Inter against mono. The zoom box also drops the accent focus ring.
14. **Selected states differ.** Toolbar and sidebar segments use a grey background; print
    segments use a pale accent with bold accent text; manual sheet tabs use grey and bold.
    Pick one.
15. ~~**White text on the Amber and Teal accents is hard to read.**~~ *Settled: the accent is fixed
    at Deep teal, which takes white text (APCA Lc 70), and accent-coloured text goes through the
    new `--accent-text` token.*
16. **Controls without a hover state, where similar ones have one:**
    - Scale dialog chips
    - Print section headers and links
    - Manual layout's align buttons, tabs and add button
    - Outline expand arrows
    - Inactive title-bar and sidebar tabs, which only change colour
17. **Close buttons come in four styles:** tab close, dialog X, print X (no text change on
    hover), and the manual sheet tab's text "×" with no hover.
18. **Nothing has a pressed (`:active`) state anywhere.**
19. **Field heights vary:** 28, 30, 32 and 34 px across the Export, Print, Manual and preset
    editors, and print fields don't use the shared field style.
20. **Toolbar sizes don't line up.** The sidebar toggle is 34 px, the groups beside it 36 px.
    Icon sizes and stroke weights are mixed (18 px at 1.4, 14 px at 1.5, the magnifier handle
    at 1.5).
21. **Light theme: pages may vanish into the mini map.** The map background and the page are
    both white. *(runtime, not checked)*
22. **Modal backdrops and shadows differ:** dimming of 0.35 against 0.45, and two shadow sizes.
23. **The printable-area outline uses a third red** (`#e05555`), unrelated to `--danger`. (With
    the old red accent it also read like a selection; the accent is teal now.)
24. **Manual layout thumbnails use off-white paper** (`#fbfbf9`); everywhere else pages are
    white.
25. **The manual strip thumbnails use a grab cursor,** which breaks the arrow-on-controls rule.
    The mini map and canvas scrollbars may also inherit the open-hand cursor while Space is
    held.
26. **The debug overlay covers the top of the vertical canvas scrollbar.**
27. **The status-bar hint can shift sideways** as the scale button appears or changes width
    *(runtime, not checked)*.
28. **The zoom preset list's rows are 28 px with accent text for the current one;** the menus
    use 30 px rows and a tick.
29. **Radii are spread across 4, 5 and 6 px** for similar small controls.
30. **Single "Close" buttons are primary in About, Properties and Shortcuts, but plain in
    Export.**

63. **"Fit page" and "Fit width" are the only text buttons on the toolbar** (`Toolbar.svelte:229`),
    among icons; both are also in the zoom box's dropdown. *(Found by Matt, 12 November 2026;
    numbered after the original 62.)*

64. **Sidebar thumbnails of very tall pages shrink to a thin column.** Each thumbnail is the
    sidebar's width less 32 px a side, with its height capped at A-series portrait proportions
    (`Thumbnails.svelte:50`), so a 1:5 page ends up about 37 px wide. Very wide pages similarly
    become slivers. *(Found by Matt, 12 November 2026.)*
65. **The mini map looks blurry after it's resized** *(found by Matt, 12 November 2026)*. It drew
    the viewer's page previews, made once at a fixed low resolution (`viewer.ts:963`), so a
    bigger map stretched them. *Fixed, confirmed by Matt:* when the map is drawn bigger than its
    images, it asks for proper renders at the drawn size (`viewer.thumbnail`, the sidebar's
    low-priority queue) once resizing has stopped for 250 ms, and stretches the old image
    meanwhile. The sizing rule is `view/mapRender.ts` (tested). It caps a render's total pixels
    (about 4 MP) rather than its long side, because the aerial drawing (1:19) needed a 3520 px
    length that a 2048 px long-side cap refused. Renders are per document and let go when a page
    leaves the map. The temporary diagnostic log is removed.
66. **Rotating a quarter turn changed the mini map's height and kept its width** *(found by Matt,
    12 November 2026)*, because its size rule fixes the width for any shape. *Fixed, confirmed by
    Matt:* `mapBox`, `mapLimits` and `mapGuardSize` take a `turned` flag, so a
    quarter-turned map swaps width and height instead (tested in `viewMath.test.ts`).

## Tier 3: menus, toolbar and naming

31. **Properties is in two menus under two names:** File > "Document properties" and
    Document > "Properties", both Ctrl+D.
32. **One action, two names:** "Reveal in Explorer" in the File menu and "Open containing
    folder" in the tab menu. Windows says "Open file location". It also fails silently; the
    Rust error messages for it are never shown.
33. **The Columns tooltip says "View > Columns to change";** the submenu is "Columns across".
34. **Automatic navigation shows two ways.**
    - The menu ticks "Automatic", but the toolbar shows CAD or Document pressed.
    - Clicking the pressed one silently switches from automatic to a fixed choice.
    - The tooltip "(View menu to change)" is wrong: only going back to automatic needs the menu.
35. **The layout options are in different orders:** Continuous, Single page, Columns in the
    menu, and Single, Continuous, Columns on the toolbar. They're also enabled in the menu with
    no document, but disabled on the toolbar.
36. **View > Mini map can be ticked with nothing showing,** because the map only appears when
    it has something to show.
37. **The status-bar navigation hint shows with no document open.**
38. **Changing "Columns across" jumps, while every other view change eases.** It's a relayout,
    so probably fine.
39. **The navigation modes are named three ways:** "CAD navigation" in the menu and toolbar,
    "CAD mode" in the shortcuts dialog, and "mode" in the README.
40. **The sidebar control has three names:** "Toggle sidebar", "Sidebar (Ctrl+B)" and "Show or
    hide the sidebar". **Open has four:** "Open…", "Open file (Ctrl+O)", "Open a file" and
    "Open".
41. **The sidebar tab says "Outline", but its messages say "bookmarks".**
42. **The empty state's Ctrl+O badge sits after "drop PDFs and images here"**, as if it were
    the shortcut for dropping.
43. **The tab close button has no tooltip.** The window Close is "Close window" to screen
    readers but "Close" on hover.

## Tier 4: words

44. **A developer instruction is shown to users.** "pdfium.dll not found: run \`node
    tools/fetch-pdfium.mjs\`" can appear as a tab error (`src-tauri/src/pdfium.rs:53`).
45. **Em-dashes in titles:** "Print — {title}" and "Print — manual layout".
46. **Internal error text can reach the screen** through tab errors, "Export failed" and the
    print status:
    - "no workers"
    - "document not open"
    - "could not create bitmap"
    - "missing path header"
    - an "Access is denied. (os error 5)" with the full path
    - a Rust debug dump for a failed PDFium load
47. **"Could not" and "Couldn't" are mixed,** mostly "Could not" in Rust; the UI's tone is
    "Couldn't".
48. **Key notation is mixed:** "Ctrl + wheel", "Space-drag", "Ctrl+scroll" and "Shift-click".
    Suggested: "Ctrl+wheel", "Space+drag", "Shift+click".
49. **The status-bar hints are worded differently from the shortcuts dialog.** CAD says
    "Scroll zoom", but a touchpad scroll pans in CAD.
50. **Trailing full stops on messages are mixed.**
51. **Export and print each have their own page-range parser,** with different messages ("e.g."
    against "such as") and different empty-range behaviour.
52. **The print dialog's "View" and "Marquee" options are unclear.** Suggested: "On screen" and
    "Area", with "rectangle", "region" and "area" settled on one word.
53. **Print says "Printing cancelled", in red as an error;** the button is "Stop", and Export
    says "Stopped".
54. **Progress messages are written differently:**
    - "Printing sheet 1 of 3", with no ellipsis
    - "Exporting page 1 of 3…"
    - "No printer is installed" against "No printers found"
55. **Paper and sheet are mixed in the print dialogs:** "Paper size" against "Sheet", with
    different margin choices. The primary button is "Print" in one and "Print 3 sheets" in the
    other.
56. **Print sizing says "Fit" and "Actual";** everywhere else it's "Fit page" and "Actual size".
    **Tiling is offered twice:** under Sizing, and again under "Special".
57. **The manual layout talks about pages even when the item is an image.**
58. **Other small wording points:**
    - "MP" against "megapixels"
    - "went out at 96 dpi"
    - "Something went wrong"
    - the window title and the print job name put the file name and "Vellum" in opposite
      orders
    - a strip label truncated without "…"
59. **The password flow matches the exact Rust error text.** Rewording it would silently break
    the flow. Use codes instead.

## Tier 5: help and docs

60. **The shortcuts dialog is missing:**
    - Ctrl+Shift+D
    - Alt and F10 for the menus
    - the mini map's click, drag, grip and reset
    - scrollbar track clicks
    - single-page wheel page-turning
    - the sidebar edge double-click

    It also tags the double middle-click fit as CAD only, but it works in both modes.
61. **The new features have no keyboard route:** Fit width, the three layouts, Columns across,
    and the navigation modes.
62. **The README is behind:**
    - per-tab state
    - "CAD mode (default)"
    - the View menu without Columns

## Decisions for Matt (not bugs)

- **Decided 12 November 2026: one fixed accent, Deep teal `#0d9488`.** The switchable accent is
  gone (View > Accent, the setting and the accent maths), so the accent can also be the icon's
  colour. Buttons on it take white text: APCA Lc 70, against Lc 39 for dark text (WCAG 2's ratio
  said the opposite and was wrong; see `docs/mockups/accent-and-icon.html`). Accent-coloured text
  goes through `--accent-text` (`#2dd4bf` in dark, Deep teal itself in light) and is fine
  wherever it helps: links, the current item, a selected label. This
  settles item 15 and makes item 10 moot.
- **Decided 12 November 2026: the app icon.** A V whose right arm is a fan of three sheets, on a
  Deep teal tile with a soft glow, plus hand-drawn 16 and 24 px versions. Sources in
  `src-tauri/icons/source/`, the set built by `node tools/make-icons.mjs`, drawn in
  `docs/mockups/icon.html`. It replaces the page glyph in the title bar, About and the empty
  state.

- **The other questions were answered on 12 November 2026:** see "Decided" at the end of the
  proposals. Nothing is left open.

## Tier 1: what was fixed (12 November 2026)

All eight are fixed. The pure rules live in `lib/engine/keys.ts` (new, tested) and
`lib/shell/menuNav.ts` (extended, tested); the components only call them.

1. **F5 / Ctrl+R in a dialog.** The WebView2 guard now also runs in the capture phase on the
   window (`App.svelte`, `guardWebView`), so a dialog or menu stopping the key can't skip it.
   `isWebViewAccelerator` holds the key list. *Only confirmable in the running app.*
2. **Menu type-ahead.** `menuKey` now takes the modifiers. With Ctrl, Alt or Meta held, or an
   F-key, it returns `closeAndPass`: the menu closes and the shortcut runs. Modifier keys on
   their own and F10 pass through untouched, so Alt and F10 still toggle the menu bar.
3. **Print dialog leaking keys.** `App.svelte` has one `modalOpen` (any dialog, or the print
   dialog unless it's hidden for an area pick). The shell shortcuts, the navigation keys
   (`input.ts`, through a new `blocked` callback) and the menu bar's Alt and F10 (`MenuBar`'s new
   `disabled` prop) all stand down while it's true. This also covers focus on the page body,
   which stopping propagation at the backdrop would not. Z-index: `--z-menu`, `--z-print` and
   `--z-dialog` in `app.css`, with dialogs above the print dialog.
4. **Keys through an open menu.** The menu now swallows every key it doesn't use. Moving the
   pointer off a submenu also takes focus back to the parent menu; before, focus fell to the
   page body and keys reached the drawing.
5. **Dialogs focusing the X.** `Dialog.svelte` now looks in priority order: `[autofocus]`, a
   field in the body (skipping disabled fields and unchecked radios), the primary button, any
   body button, any footer button. Never the header X.
6. **Two typing checks.** `isTypingTarget` and `blockedWhileTyping` in `keys.ts` are used by
   `App.svelte`, `input.ts` and `ManualLayout.svelte`. The rule: Ctrl and F-key shortcuts work
   everywhere; bare keys (R, +, PageDown, Space) are ignored in a field. TEXTAREA now counts.
7. **Key repeat.** The shell shortcuts ignore held-key repeats (except Ctrl+Tab, which may
   cycle), as do F12, Ctrl+Shift+D and Ctrl+O. Zoom and page keys still repeat on purpose.
8. **Keys with no document.** R and the view keys (+, -, Ctrl+0, Ctrl+1, page keys) do nothing
   without a document, through a new `hasDoc` callback. Ctrl+O, F12 and Space still work.

## Proposals for Tiers 2 to 5 (not implemented)

Grouped so one change closes several items, and listed in the order I'd do them: each group
makes the next smaller. Sizes: **S** under an hour, **M** about half a day, **L** a day or more.

### A. Layering and paper tokens (items 22, 23, 24) · S

The tokens the other groups build on. The accent tokens are already done: Deep teal is fixed in
`app.css`, buttons on it keep white text, and `--accent-text` (per theme) carries accent-coloured
text. The z-index tokens came with the Tier 1 fixes.

- **Change:** add to `app.css`:
  - `--scrim` (one backdrop dimming, 0.4) and `--shadow-pop` / `--shadow-modal` (menus and
    dialogs).
  - `--paper: #ffffff` and `--print-margin` for the printable-area outline.
- **Files:** `app.css`, `Dialog.svelte`, `PrintDialog.svelte`, `ManualLayout.svelte`,
  `MenuPopup.svelte`.
- **Before / after:** two dimmings and two shadows become one each. Off-white manual thumbnails
  and a third red become white paper and a margin colour of their own.
- **Choice, printable-area colour** (mockup A2): (a) a neutral blue-grey dashed line, (b) the
  accent at half strength. **Recommend (a):** it's a guide, not a warning or a selection, and it
  doesn't compete with the teal selection.

### B. One button and field style (items 12, 13, 19, 29, 30) · M

- **Change:** the global `.btn` and `.field` become the only button and field styles. Two
  heights: 32 px for buttons and dialog fields, 28 px for compact fields (toolbar page and zoom
  boxes, the print side panel). Radius 6 px for buttons and fields; 4 px only for chips inside a
  field. Delete the local restyles in `PrintDialog.svelte:1170` and `ManualLayout.svelte:1427`
  (34 px footers, their own padding, the brightness filter).
- **Files:** `app.css`, `PrintDialog.svelte`, `ManualLayout.svelte`, `ExportDialog.svelte`, the
  preset editor, `Toolbar.svelte` (page and zoom boxes).
- **Before / after:** four field heights (28, 30, 32, 34) become two. The page box (24 px, Inter,
  radius 4) beside the zoom box (30 px, mono, radius 6) become a matched pair: 28 px, mono
  numerals, radius 6, both with the accent focus ring, both dimmed with no document.
- **Choice, page and zoom boxes** (mockup B3): (a) both boxed, with a visible border; (b) both
  quiet, no border until hovered or focused (as the zoom box is now). **Recommend (a):** it
  says "you can type here" without hovering.
- **Item 30:** a lone "Close" is primary everywhere. About, Properties and Shortcuts already
  are; Export's finished state changes to match.

### C. Interaction states (items 11, 16, 18) · S, after B

- **Change:** one rule set in `app.css` for every clickable control:
  - hover: the `--hover` background;
  - pressed: `:active` one step darker (a new `--press` token);
  - disabled `input`, `select` and `.field`: the same 0.45 opacity as disabled buttons.

  Then the item-16 controls (scale chips, print section headers and links, manual align buttons,
  tabs and add button, outline arrows, inactive title-bar and sidebar tabs) use the shared
  class instead of their own.
- **Files:** `app.css`, `ScaleDialog`, `PrintDialog`, `ManualLayout`, `OutlineTree`, `TitleBar`,
  `Sidebar`.
- **Before / after:** no pressed state anywhere, a dozen controls without hover, and live-looking
  disabled boxes, become controls that all hover, press and dim the same way.

### D. One selected-state treatment (items 9, 14, 28) · S

- **Change:** a `.seg` style in `app.css` for every segmented control. The sidebar toggle gets
  the same `.on` style (it has none now). The manual sheet tabs adopt the tab style. The zoom
  preset list uses the menu's 30 px rows and a tick; its teal current value can stay.
- **Files:** `app.css`, `Toolbar.svelte`, `Sidebar.svelte`, `PrintDialog.svelte`,
  `ManualLayout.svelte`.
- **Choice, selected look:** (a) pale accent background with teal text (`--accent-text`), normal
  weight; (b) pale accent background, normal text; (c) grey, as the toolbar has now. Print's
  current bold teal is dropped in all three, since bold shifts the label's width. **Recommend
  (a):** you're happy with teal text where it helps, and it marks the choice most clearly in
  both themes. Icon-only segments (toolbar layout and navigation) show the same background,
  with the icon in teal.

### E. One close button (items 17, 43) · S

- **Change:** a `CloseButton.svelte` (12 px X, in a 32 or 20 px box, `--hover` background, the X
  brightens) used by the dialog header, the print header, the manual sheet tab and the document
  tab. Tooltip and accessible name agree: "Close tab", "Close", "Close window".
- **Files:** the new component; `Dialog`, `PrintDialog`, `ManualLayout`, `TitleBar`.
- **Before / after:** four styles, one with no hover, and a tab close with no tooltip, become
  one.

### F. Toolbar, canvas and cursor details (items 20, 21, 25, 26, 27, 63) · M

- **Item 63:** Fit page and Fit width become icon buttons with tooltips (decided; see "Decided").

- **Item 20:** the sidebar toggle goes to 36 px; icons to one set, 16 px at a 1.5 stroke.
- **Item 21, choice** (mockup F2): (a) keep the light theme's map white and outline each page
  in `--bd-strong`; (b) give the light map a pale grey background, as the dark theme's map
  already has. **Recommend (b):** it copies the relationship that already works, with no extra
  line. Needs your eye in the light theme.
- **Item 25:** the arrow on manual strip thumbnails (the grab hand only while dragging). The
  mini map and scrollbars set `cursor: default` themselves, so Space's open hand doesn't reach
  them.
- **Item 26:** the debug overlay moves left by the scrollbar's width.
- **Item 27:** reserve the scale button's slot (a min-width) so the hint doesn't move.
- **Files:** `Toolbar`, `MiniMap`, `CanvasScrollbars`, `DebugOverlay`, `StatusBar`,
  `ManualLayout`.

### G. Menu and toolbar behaviour (items 34, 35, 36, 37, 38) · M

- **Item 34:** options drawn in `docs/mockups/ui-proposals.html` (G1). (a) A small accent dot on
  the pressed button while automatic; going back to automatic still needs the menu. (b) A third
  "Auto" segment, pressed while automatic, with the resolved mode in a hairline; one click goes
  back to automatic, so the "View menu to change" tooltip goes. **Recommend (b)**, at the cost
  of one more button (about 34 px).
- **Item 35:** one order everywhere: Single page, Continuous, Columns. Disabled in the menu
  without a document, as on the toolbar.
- **Item 36:** waits on your decision on the menu item's name (below).
- **Item 37:** hide the navigation hint without a document.
- **Item 38:** leave it. A relayout can't ease meaningfully.
- **Files:** `App.svelte` (menus), `Toolbar.svelte`, `StatusBar.svelte`.

### H. One naming list (items 31, 32, 33, 39, 40, 45, 48, 52, 55, 56, 57, 58) · M

A table of every user-facing name, kept in `docs/`, then one pass to make the code match it.
Proposed names:

| Thing | Name everywhere |
| --- | --- |
| Properties (31) | "Document properties", in the File menu only; dropped from Document |
| Reveal (32) | "Open file location" (Windows' wording), in the menu and the tab menu |
| Columns (33) | tooltip "Columns: View > Columns across" |
| Modes (39) | "CAD navigation" and "Document navigation" in menu, toolbar, shortcuts and README |
| Sidebar (40) | tooltip "Sidebar (Ctrl+B)", accessible name "Show or hide the sidebar" |
| Open (40) | "Open…" in the menu, tooltip "Open (Ctrl+O)", accessible name "Open a file" |
| Print titles (45) | "Print: {title}" and "Print: manual layout", no em-dash |
| Key notation (48) | always `+`: "Ctrl+wheel", "Space+drag", "Shift+click" |
| Print area (52) | "On screen" and "Area"; "area" as the one word throughout |
| Paper (55) | "Paper" for the physical sheet, "Sheet" only for a manual-layout sheet; one margin list; primary button "Print" in both |
| Sizing (56) | "Fit page" and "Actual size"; tiling offered only under Sizing |
| Images (57) | "item" wherever it can be a page or an image |
| Small points (58) | "megapixels"; "printed at 96 dpi"; "{file} - Vellum" for both the window title and the print job; "…" on truncated strip labels; "Something went wrong" replaced by group I's messages |

- **Files:** `App.svelte`, `Toolbar`, `TitleBar`, `StatusBar`, `ShortcutsDialog`, `PrintDialog`,
  `ManualLayout`, `README.md`, the header comment in `input.ts`.
- **Item 41** waits on your Outline or Bookmarks decision.

### I. One error and progress style (items 32, 44, 46, 47, 50, 53, 54, 59) · L

- **Change:** errors from Rust carry a code (`pdfium_missing`, `access_denied`, `no_printer`,
  `wrong_password` and so on) plus detail. The front end maps codes to one set of messages in
  one file (`shell/messages.ts`, pure, tested). An unknown code shows "Couldn't {verb} {file}.",
  with the raw text only in the log. Style: "Couldn't", a sentence with a full stop, no paths or
  OS error numbers. Progress: "Printing sheet 1 of 3…" and "Exporting page 1 of 3…". A stop is
  "Stopped", in the normal text colour, not red. One "No printers found".
- **Item 32** (the reveal failing silently) and **item 59** (the password flow matching Rust's
  text) both fall out of the codes.
- **Item 44:** the missing-DLL message becomes "Vellum is missing a file it needs (pdfium.dll).
  Reinstall Vellum."
- **Files:** the error types in `src-tauri/src/` (PDFium, print, export, reveal), `print/api.ts`,
  `App.svelte`, `ExportDialog`, `PrintDialog`, `PasswordDialog`, the new `shell/messages.ts`.
- **Choice:** (a) codes from Rust, as above; (b) keep the strings and match known substrings in
  the front end. **Recommend (a):** (b) is exactly the fragility item 59 describes.

### J. One page-range parser (item 51) · S

- **Change:** Export uses the print parser (`print/model/pages.ts`). One message ("Use page
  numbers and ranges, such as 1-3, 7"), and an empty box means all pages in both.
- **Files:** `ExportDialog.svelte`, `print/model/pages.ts`, tests.

### K. Help, keyboard routes and README (items 49, 60, 61, 62) · M, last

Last because it documents the names and behaviour the groups above settle.

- **Item 60:** the missing rows in the shortcuts dialog (Ctrl+Shift+D, Alt and F10, the mini
  map, scrollbar track clicks, single-page wheel, the sidebar edge double-click); the double
  middle-click marked as both modes.
- **Item 61:** keyboard routes for the new features. Suggested: Ctrl+2 fit width;
  Ctrl+Shift+1/2/3 for Single page, Continuous and Columns; N to switch between CAD and
  Document navigation. To confirm, since they become muscle memory.
- **Item 49:** the status-bar hints use the shortcuts dialog's wording. In CAD, "Wheel zoom",
  not "Scroll zoom", since a touchpad scroll pans.
- **Item 62:** the README gains per-tab state, automatic navigation as the default, and the View
  menu with Columns.
- **Files:** `ShortcutsDialog.svelte`, `input.ts`, `App.svelte` (menu shortcuts), `StatusBar`,
  `README.md`.

### Recommended order

A (tokens), B (buttons and fields), C (states), D (selected state), E (close button), H (names),
I (errors), J (range parser), G (behaviour), F (details), K (help and README).

### Decided (Matt, 12 November 2026)

These override the recommendations in the groups above where they differ. Mockup sections in
brackets, in `docs/mockups/ui-proposals.html`.

- **Printable-area line** (A2, group A): **teal at half strength**, not the neutral blue-grey.
- **Page and zoom boxes** (B3, group B): **both boxed, at the page box's smaller, tighter size**
  (about 24 px and its tighter padding), rather than 28 px. *Assumed:* both use monospace
  numerals, as the zoom box does now.
- **Selected look** (D, group D): **pale teal with teal text**, unless it looks worse in the
  app; then pale teal with normal text.
- **Automatic navigation** (G1, group G): **the "Auto" segment.**
- **Error messages** (group I): **codes from Rust.**
- **Sidebar tab** (item 41): **"Bookmarks"** (Bluebeam, Acrobat, Foxit and most dedicated viewers
  call it that). Its messages already say bookmarks.
- **Layout for new files:** **a fixed default, Continuous**, like the other per-file settings.
- **Mini map menu item** (item 36): **a three-way choice** in place of the tick: View > Mini map >
  Automatic (today's behaviour: shown when useful), Show, Hide, remembered per file.
- **Empty state's Ctrl+O badge** (item 42): **dropped**; the menus and tooltips already show the
  shortcut.
- **Sidebar thumbnails** (item 64, group F): **use more of the sidebar.** Tall pages may grow
  to twice their width before they start to narrow (today they stop at A-series portrait); wide
  pages span nearly the full sidebar width (8 px margins, not 32). Nothing is cropped, and
  ordinary pages look as they do now. Matt's problem is the tall pages; the wide-page part comes
  with the option he chose.
- **Fit page and Fit width** (item 63, mockup F6, group F): **icons with tooltips** ("Fit page
  (Ctrl+0)", "Fit width (Ctrl+2)") in their own toolbar group, in place of the text buttons. They
  stay in the zoom dropdown too.
- **Ellipsis on Properties, About and Keyboard shortcuts:** **none**, as now.
- **Keyboard routes** (item 61): **Ctrl+2** fit width, **Ctrl+Shift+1/2/3** Single page,
  Continuous, Columns, **N** to switch CAD and Document navigation.
- **Licence names:** the About dialog uses the official "SIL Open Font License 1.1" (a proper
  name, so its own spelling); the rest of the app keeps UK spelling. Done.
- **Properties** (item 31): **File menu only**, as "Document properties"; dropped from Document.
- **Reveal** (item 32): **"Show in Explorer"** in both the File menu and the tab menu.
- **Print area** (item 52): **"On screen" and "Area"**; "area" is the one word for the dragged
  rectangle throughout.
- **Paper and sheet** (item 55): **"Paper"** for the physical page everywhere; **"Sheet"** only
  for a manual-layout sheet.
- **Print sizing** (item 56): **keep the short "Fit" and "Actual"** (the full names won't fit the
  side panel); **tiling only under Sizing**, removed from Special.
- **Window title and print job name** (item 58): **"{file} - Vellum"** for both.
- **Layout order** (item 35): **Single page, Continuous, Columns** in the menu and on the toolbar.
- **Compact fields** (group B): **all compact fields** (toolbar boxes, print side panel, preset
  editor) take the page box's tighter size; dialog fields stay 32 px.
- **A lone Close** (item 30): **primary everywhere**, Export's finished state included.
- **Empty page range** (item 51): **all pages**, in both Export and Print.
- **Stopping a print or export** (item 53): **"Printing cancelled" and "Export cancelled"**, in
  the normal text colour, not red; both buttons stay "Stop".
- **Columns across** (item 38): **leave the jump**; the pages rearrange completely, so there's
  nothing meaningful to ease between.

Treated as agreed unless Matt objects (no real alternative was offered; details in the groups
above): one backdrop dimming and one shadow per kind (item 22); white paper in manual layout
(item 24); the zoom preset list as a menu with a tick (item 28); one "No printers found" and
matching progress wording (item 54); the hover, pressed and disabled states (group C); one close button with matching tooltip
and accessible name (group E); toolbar sizes and icons, cursors, the debug overlay's position and
the status-bar hint's fixed slot (items 20, 25, 26, 27); hiding the navigation hint with no
document (item 37); the remaining names in group H (the Columns tooltip, "CAD navigation" and
"Document navigation" everywhere, the Sidebar and Open tooltips, "Print: {title}" without an
em-dash, "Ctrl+wheel" style key notation, "item" for a page or image, "megapixels", "printed at
96 dpi", "…" on truncated labels); group I's message style ("Couldn't", sentences with full
stops, no paths or OS error numbers) and the missing-DLL wording; group K's help additions and
"Wheel zoom" in the CAD hint.

- **Mini map in the light theme** (item 21, F2): confirmed by Matt in the app (page edges aren't
  very visible). **A pale grey map background** in the light theme, as the dark theme's map
  already has; pages stay white.

Nothing is left open.

Found and fixed after the build (13 November 2026):

- **Tab hover card** (asked for, like Chrome's): after half a second on a tab, a card with the
  full name, the folder, "Page x of y" (or why the file didn't open), and for a background tab a
  picture of the view as it was left (`Viewer.detach()` snapshots the canvas; `view/snapshot.ts`).
  Replaces the path tooltip. Confirmed by Matt.
- **Manual layout strip: dragging was refused everywhere** (the blocked cursor). The window takes
  Explorer file drops (`dragDropEnabled`), which on Windows refuses HTML drag and drop inside the
  page; the strip now drags with pointer events, with a small ghost. Confirmed by Matt.
- **Side panels squashed in a short window** (the manual layout's sheet buttons overlapped): the
  sections and `.btn` no longer shrink, so the panel scrolls; same guard on the Print options.
- **The manual layout sheet jumped back to Fit after a drag**: the refit effect read the whole
  layout; it now watches only the paper size. Resizing refits only while the sheet is still at Fit.
- **Overlapping ghost buttons in the manual layout** (Clear sheet, Reset crop, Remove from sheet):
  the strip's drag preview was styled as `.ghost`, which those buttons share; renamed.
- **Manual layout labels can name the file** (per item, ticked automatically when the layout uses
  more than one file; saved with layouts).
- **Right column overflowed** with a long file name; it wraps now, and X / Y drop the "mm" from
  the fields (it's in the label).
- **Print and Manual layout move and resize** (Matt's choice over filling the window or a separate
  OS window): drag the header, drag any edge or corner, double-click the header for the default
  size, centred. Print and Manual layout share one box (1240 x 800 by default), so they behave
  as two pages of one window, and it's remembered. `shell/floatBox.ts` (+ test), `components/floating.ts`.
- **Manual layout labels: three independent parts** (File name, Page number, Scale); the
  selection badge stays page and scale, and long names shorten in the printed label.
- **Drag preview centred on the pointer**, drawn at the size the page will land at.
- **Manual layout remembered per file** (the file Print was opened from; `print/layoutMemory.ts`,
  + test, 50 most recent). Missing files are left out and named; the remembered copy isn't
  overwritten until the layout is changed. "Start again" forgets it.
- **Black lines rebuilt for scans** (Matt: it turned CAD exports and scans like Bayou Towers into
  smudge). It was one fixed cut-off (anything not near white went black). Now each dot is judged
  against the paper within about 1.5 mm of it (adaptive thresholding): paper texture, stains and
  uneven tone go white, lines go black however faint, pale fills go white, solid black stays,
  coloured lines count as dark, and mostly dark sheets (blueprints) are read inverted. A
  sensitivity slider ("Bold lines only" to "Faint lines too") shows with Black lines; saved with
  presets. Rust `job::black_lines` and TS `print/blackLines.ts` match (same tests); the preview
  uses the latter. Black lines always prints as an image (never Vector). Save as PDF doesn't
  apply colour modes at all (unchanged). The slider's far left drops everything (margin 100%,
  squared towards 5% at the right; solid-black guard fades out below half). Confirmed by Matt.
- **Print preview zooms**: wheel at the pointer, drag to move, double-click to fit; renders only
  what's on screen, sharp for the zoom; zoom survives settings changes. Under the Black lines
  slider, "Preview is exact only at 1:1" with a "View 1:1 at N dpi" button.
- **Black lines slider reached neither end**: the dialog's text-box padding applied to it.
- **Print settings reordered** (Matt): Printer; Copies and Collate; Paper and orientation; Pages;
  Layout (Automatic | Manual); Sizing with Margins and the shrink option (worded per mode); Colour.
  Sections: Arrangement (pages per sheet, centre, Marks), Output (two-sided, reverse, tray by page
  size), Advanced. The duplicate auto-rotate tick went. Controls are all 24 px; the sizing note
  lost its box, warnings show red with a triangle (`SizingNote.warn`). Printer properties says
  it's opening (Epson takes seconds).
- **To scale with no drawing scale is a percentage** (`scalePercent`, own presets); the manual
  layout shows one Scale control then.
- **Manual is a mode of the print dialog**: Layout: Manual previews and prints the manual layout
  from the main dialog, so Colour, Output and Advanced apply to it; Pages, Paper, Sizing and the
  automatic arrangement hide; "Edit layout…" opens the editor, Back returns with it.

Follow-ups, done 13 November 2026 (`docs/followups-scope.md`):

- **Paper size list order**: A sizes first, largest first (Vellum's users are in the UK);
  everything else, US sizes included, under "Other sizes" in the driver's order
  (`print/paperOrder.ts`, + test). Both print screens.
- **Save as PDF honours colour modes**: Colour saves the composed vector PDF; Greyscale and
  Black lines save a raster PDF at the print resolution, filtered page by page as printing is,
  stored as greyscale JPEG strips (`rasterpdf.rs`, shared band code in `bands.rs`;
  `tests/print_rasterpdf.rs`).
- **One margin list**: Printer minimum, None, 5, 10, 15 mm, Custom in both screens.
- **Label columns line up** across the print settings and its sections (110 px).
- **README rewritten**.

Raised, separate from this review:

- **PDF layers** (optional content). **Parked** (Matt, 13 November 2026): it comes alongside or
  after the markup and light editing tools. Drawings exported from AutoCAD and Revit often have them;
  Acrobat and Bluebeam show them in a "Layers" sidebar tab beside Bookmarks. Needs a check first
  that PDFium can list layers and switch them on and off, rather than only drawing them as the file
  says.
