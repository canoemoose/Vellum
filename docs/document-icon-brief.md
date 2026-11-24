# Document icon: brief

**Status (24 Nov 2026): built, not yet checked in Explorer.** Sources in
`src-tauri/icons/source/document*.svg`, `document.ico` built by `make-icons.mjs`, the file types
split in `installer-hooks.nsh`. A local `npm run tauri build` makes an installer that works
(only the updater signature fails without the key), so it can be checked without a release.

PDFs that open in Vellum show the bare app icon in Explorer today. Give them a document icon
instead: a page with a folded corner and the Vellum tile as a badge, bottom left (option A of
three mocked up for Matt, 24 Nov 2026; the Windows 11 / Office convention). At the same time,
split the one file type Vellum registers into one for PDFs and one for images.

## What's there now

- `src-tauri/windows/installer-hooks.nsh` registers one file type, `Vellum.Document`, per
  user, for `.pdf` and the image types (jpg, jpeg, png, webp, tif, tiff, bmp, gif) as an
  "Open with" handler. Its `DefaultIcon` is `vellum.exe,0`, the app icon. Explorer shows that
  icon on any of those files once the user makes Vellum their default for the type.
- The app icon set is built by `tools/make-icons.mjs` from `src-tauri/icons/source/`:
  `vellum.svg` (32 px and up), `vellum-24.svg` and `vellum-16.svg` (hand-drawn for those
  sizes), rendered with headless Edge into `src-tauri/icons/icon.ico` and the rest.

## The design

- **Page:** white, a thin grey outline, the top-right corner folded (a light grey triangle),
  small corner radii. Upright, roughly the proportions of an A-series sheet. No "PDF" or
  other label on it: Windows 11's own document icons don't carry one, and the file's name and
  type column say what it is.
- **Badge:** the app tile, as it is (dark teal rounded square, the mark on it), over the
  bottom-left of the page and overhanging its left edge, a little under half the icon's
  width. Use the existing drawings. Built: the full app icon (`vellum.svg`, glow and
  lighting) from 64 px up (`document-full.svg`; Matt, after comparing 64, 96 and 256 px); the
  flat `vellum-24.svg` drawing at 32 to 48 px (`document.svg`); `vellum-16.svg`'s, scaled, at
  16 to 24 px.
- **Sizes:** 16, 20, 24, 32, 40, 48, 64, 96 and 256 px in the .ico (Explorer picks from
  these at every view size and display scale).
- **16 and 24 px are drawn on the pixel grid**, like the app's: at 16 px the page is a sliver
  of outline and fold behind a badge that's most of the icon (Office does the same). Expect
  to hand-tune these; shrinking the big one won't do.
- Matt judges the look. Render a sheet of every size on light and dark Explorer backgrounds
  for him before wiring anything up.

## Files

- `src-tauri/icons/source/document.svg`, `document-24.svg`, `document-16.svg`: new sources.
- `tools/make-icons.mjs`: also build `src-tauri/icons/document.ico` from them. Keep the app
  icon output byte-for-byte unchanged.
- `src-tauri/tauri.conf.json`: ship `icons/document.ico` as a resource, installed beside the
  exe (`bundle.resources`, as `pdfium.dll` is).
- `src-tauri/windows/installer-hooks.nsh`:
  - Register `Vellum.PDF` ("Vellum PDF document", `DefaultIcon` `$INSTDIR\document.ico`) and
    add it to `.pdf`'s `OpenWithProgids`.
  - Register `Vellum.Image` ("Vellum image", `DefaultIcon` the app icon, `vellum.exe,0`) and
    add it to each image type's `OpenWithProgids`.
  - Both open with the same command as today.
  - Remove `Vellum.Document`: its entry from every type's `OpenWithProgids`, and its key, on
    install as well as uninstall, so Open with doesn't list Vellum twice after an update.
  - Uninstall removes both new types.
  - Leave the `Applications\vellum.exe` key (the app in the Open with list) and its app icon
    as they are. The existing `SHChangeNotify` call tells Explorer to refresh.
- `CLAUDE.md`: the make-icons line mentions the document icon.

## Decided

- **Split the file type now, before 0.2.0.** Windows remembers a user's default app by the
  file type's name (`Vellum.Document` today), and an installer may not change that choice.
  So a rename strands everyone who has already made Vellum their default, on the old type
  and its icon, until they choose Vellum again by hand. Today that's only Matt, who will
  choose it again once after updating. After release it would be every user, so the names
  are settled here: `Vellum.PDF` and `Vellum.Image`, for good.
- **Images keep the app icon** for now. Thumbnail views show the image itself anyway. An
  image icon of its own can come later by changing `Vellum.Image`'s icon, with no rename.

## Open questions

- Whether an uninstall leaves stale icons in Explorer's cache until a restart. Check once on
  a test machine; not worth working around unless it does.

## Checking it

- Only an installed copy shows the icon: build the installer (it needs the signing key, so
  through the Release workflow as a pre-release, e.g. `0.2.0-rc3`, or a local unsigned NSIS
  build if one can be made without the updater step), install, set Vellum as the default for
  `.pdf`, and look in Explorer at every view size, on 100% and 150% display scale.
- Then update over it from the previous version: Vellum should appear once in Open with for
  PDFs and images, not twice. A default chosen before the update points at the removed
  `Vellum.Document`, so choose Vellum again for `.pdf` (expected; only Matt is affected).
- Check an image type set to Vellum shows the app icon, and a PDF the document icon.
