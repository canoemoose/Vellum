# Vellum homepage: brief

**Status (26 November 2026): built (17 November) and live since 0.2.0 (25 November).** The look
was then replaced, by [homepage-redesign-brief.md](homepage-redesign-brief.md) and after it
[homepage-layout-brief.md](homepage-layout-brief.md); where they differ, the latest wins. What
this brief says about the README, the 0.1.4 button and when to switch Pages on is as it was
written, before 0.2.0.

A single public page where people can find out what Vellum is and download it. It's hosted on
GitHub Pages from this repository. This brief is for one build session: read it, build it,
commit it, then hand back with the open questions at the end answered or listed.

## Objective

A page at `https://canoemoose.github.io/Vellum/` that:

- says in a few seconds what Vellum is and who it's for;
- offers a one-click download of the latest released installer, showing its version and size;
- tells people what to expect on first install (the SmartScreen warning) so they don't give up;
- updates itself whenever a release is published, with no new step in the release checklist.

## Audience

The team, friends, and friends of friends. They're comfortable with computers, open drawings
for a living or near enough, and **won't necessarily know Matt**. So the page has to make the
download feel trustworthy to a stranger: say who made it and why, link to the source, and be
plain about the unsigned installer. It's not a marketing page for the general public, so no
hype, testimonials, pricing-style sections or newsletter sign-ups.

## Decisions already made

- **Address:** no custom domain yet. It may move to `vellum.matt-james.net` later, so every
  link and asset path is relative and nothing hard-codes `canoemoose.github.io`. Moving should
  then need only a `CNAME` file and a DNS record.
- **No code signing.** The page explains the SmartScreen warning instead (see Content).
- **Static and hand-written.** Plain HTML and CSS, no framework, no Jekyll, no client-side
  JavaScript needed to show the page or the download button. A tiny script for a theme toggle
  is fine but not required (follow the system theme).
- **No analytics, no cookies, no third-party requests.** No web fonts from a CDN either: use
  the same font stacks as the app.
- **Deployed by GitHub Actions**, not from a `gh-pages` branch.

## Constraints

- UK English. Em-dashes sparingly. Anything a script prints to the Actions log is ASCII.
- Look like Vellum: take the colour tokens (accent `#0d9488` and friends, light and dark sets)
  and font stacks from [src/app.css](../src/app.css). Filled buttons get a visible border
  (`--accent-bd`), as in the app. Text contrast is checked with APCA, not the WCAG 2 ratio.
- Works at phone width (people will be sent the link in a message) with no horizontal scroll,
  though the download itself is Windows-only. On a phone, the button still links to the
  installer, and a line says it's for Windows PCs.
- Third-party actions pinned to commits with a version comment, like the existing workflows.
  The new workflow has the narrowest permissions it needs (`pages: write`, `id-token: write`,
  `contents: read`).
- Nothing in the release workflow or the updater changes.

## How the download button works

Tauri names the installer with its version (`Vellum_0.1.4_x64-setup.exe`), so a fixed
`releases/latest/download/...` link won't work. Instead, the page is generated when it's
deployed:

1. `tools/build-site.mjs` (Node, no dependencies) copies `site/` to an output folder and fills
   placeholders in `index.html`: version, installer URL, installer size, release date, and
   the release notes URL.
2. It gets these from the GitHub API's `GET /repos/canoemoose/Vellum/releases/latest`, using
   `GITHUB_TOKEN` when it's set. That endpoint never returns drafts or prereleases, which
   matches what the updater offers. The installer is the asset matching `_x64-setup.exe`,
   not the `.sig` file.
3. **Fallback:** if the call fails or finds no installer, the build still succeeds and the
   button links to `https://github.com/canoemoose/Vellum/releases/latest` with the text
   "Download from GitHub", and the script logs a warning. A broken API call must never take
   the page down.
4. Keep the choosing and formatting (pick the asset, format "12.3 MB", format the date) in
   pure functions with Vitest tests, including the fallback cases: no assets, only a `.sig`,
   API error.
5. Runs locally too: `node tools/build-site.mjs` writes to `site-dist/` (gitignored), so the
   page can be opened in a browser before pushing. Add `npm run site` for it.

The workflow, `.github/workflows/pages.yml`, runs on:

- `push` to `main` touching `site/**`, `tools/build-site.mjs` or the workflow itself;
- `release: published` (so publishing a release redeploys the page with the new version);
- `workflow_dispatch`, for a manual redeploy.

It runs on `ubuntu-latest` (no Rust or PDFium needed): checkout, set up Node from the Volta pin,
run the build script, `actions/upload-pages-artifact`, `actions/deploy-pages`. Use a
`concurrency` group so two deploys can't overlap.

## Content, top to bottom

Source the wording from the [README](../README.md), but describe 0.2.0: the README's "What it
isn't" section still says there's no markup or measuring, which 0.2.0 changes. The page goes
live with the 0.2.0 release, so it describes 0.2.0 throughout with no "coming soon" labels.
Short sections, more pictures than words.

1. **Header:** icon ([src-tauri/icons/source/vellum.svg](../src-tauri/icons/source/vellum.svg)),
   name, and one line: "A fast PDF and image viewer for people who open drawings, not documents."
2. **Download:** primary button "Download Vellum 0.1.4" with "Windows 10 and 11, 64-bit ·
   12.3 MB" under it. A secondary link to the release notes. A line saying it updates itself
   once installed.
3. **Hero screenshot:** a large, real screenshot of a dense drawing open in the app.
4. **Why it exists:** two or three sentences on general-purpose readers struggling with big
   drawings, plus one concrete figure from [RESULTS.md](../RESULTS.md) (for example, zoomed
   renders of the heaviest test drawing in under 100 ms). One figure, not a benchmark table.
5. **What it does:** five or six short tiles, each with a small screenshot or icon. Fast and
   smooth on big drawings; navigates like CAD; real-world scale and measuring; markup, stamps
   and signatures; printing to scale (and Black lines for scans); images too.
6. **First install:** "Windows will warn you the first time" with the steps ("More info", then
   "Run anyway"), a screenshot of that dialog, and one honest sentence on why (the installer
   isn't code signed; the source is public and every release is built by GitHub Actions from
   it). It installs per user, so no admin rights are needed.
7. **Who made it:** one or two sentences, credited to **Matt James**, so strangers know it's a
   real person's tool. Keep it in one place in the markup, because it may later say Event
   Engineering or Alteka.
8. **Footer:** source on GitHub, licence, third-party notices, "No tracking on this page".
   The update check is one request to GitHub and sends nothing about you or your files.

Also add Open Graph and Twitter-card tags with a 1200 × 630 preview image, since the link will
mostly be shared in messages, where the preview is the first thing people see. Add a favicon
from the icon set.

## Screenshots

Every screenshot must show a drawing that's **free to publish**: no client or venue drawings
from real jobs. The synthetic PDFs (`npm run gen:synthetic`) are safe but look artificial.

**Source drawing:** a fictional four-sheet festival drawing set ("Fieldwork Festival") on real
Silverstone Circuit map data, generated by `test-files/drawing-set.mjs` into
`test-files/fieldwork-festival-drawing-set.pdf` (both gitignored, on Matt's machine):

- 001 site plan, A1 1:5000 (OpenStreetMap with an Ordnance Survey overlay);
- 002 event layout overall, A1 1:2500 (the hero screenshot candidate);
- 003 main arena, A1 1:500 (every barrier unit and fence panel: good for zoomed-in shots);
- 004 main stage plan, A3 1:100.

The page credits the map data wherever these screenshots appear: "Map data © OpenStreetMap
contributors (ODbL). Contains OS data © Crown copyright and database right 2026 (Open
Government Licence)." The event itself is fictional and has no connection to the venue owner;
nothing on the page should suggest otherwise.

The builder can't take the screenshots (they need the real app on a real screen), so:

- build the page with clearly labelled placeholder images at the final sizes, listed in
  `site/img/README.md` with what each should show and its pixel size;
- Matt replaces them. He captures with
  [CaptureGraphicsWin2D](https://github.com/rednoah/CaptureGraphicsWin2D), which saves the
  window as a PNG with real transparency: rounded corners and the Windows shadow, no halo.
  So the page shows screenshots as-is on the page background, with no frame, border or CSS
  shadow of its own, and it must look right in both light and dark themes. Convert to WebP
  keeping the alpha channel (lossless or high quality), each under about 300 KB, with a PNG
  fallback only if needed.

## Files in play

- `site/index.html`, `site/style.css`, `site/img/...` (new)
- `tools/build-site.mjs` and `tools/build-site.test.ts` (or wherever the Vitest config picks
  tests up; check `vite.config.ts`)
- `.github/workflows/pages.yml` (new)
- `package.json` (`site` script), `.gitignore` (`site-dist/`)
- **Not [README.md](../README.md).** Matt updates it himself (homepage link, the stale
  "What it isn't" section). Don't edit it.
- Optional, separate commit: Help menu gets "Vellum website", opening the page with the
  existing `openUrl`. It only reaches people in the next release.

## Steps

1. Build script, its tests, and `npm run site`. Check it against the real latest release.
2. The page itself, with placeholders, in light and dark, at desktop and phone widths.
3. The Pages workflow.
4. The optional Help menu item.
5. Commit, split by concern. **Don't push.** Matt pushes, then does the one-off settings
   below.

## One-off settings (Matt, after pushing)

- Repository Settings > Pages > Source: **GitHub Actions**.
- Run the workflow once (`gh workflow run pages.yml`) or push a change under `site/`.
- Set the repository's website field: `gh repo edit --homepage https://canoemoose.github.io/Vellum/`.
- Settings > Environments > **github-pages** > Deployment branches and tags: add a **tag** rule
  `v*`. Publishing a release runs the workflow on the release's tag, and the environment only
  lets `main` deploy by default, so without this rule the redeploy on publish is refused.

## Built (17 November 2026)

- `tools/build-site.mjs` (tests in `tools/build-site.test.mjs`, picked up by the existing
  Vitest `tools/**/*.test.mjs` pattern), `npm run site`, `site/`, `.github/workflows/pages.yml`.
- Checked against the real latest release (0.1.4: 6.7 MB, as Windows counts megabytes) and with
  a refused API call (falls back to the releases page, exit 0, a warning annotation in Actions).
- `SITE_URL` comes from `actions/configure-pages`, so `og:image` and `og:url` are absolute on the
  deployed page (link previews need that) without naming the host anywhere.
- The favicon and header icon are copied from `src-tauri/icons` at build time, so the workflow
  also runs on changes there.
- Images: placeholders at final size; the list is in `site/img/README.md`. That adds three
  images the screenshot list didn't have: `image-*` (the "Images too" tile), `smartscreen` (by
  hand) and `og.png`.
- Third-party notices aren't on GitHub (the file is generated at build), so the footer links the
  README's Licence section and points to Help > About.
- The optional Help menu item was not built.

## Settled (17 November 2026)

- Credit: "Matt James" for now; may become Event Engineering or Alteka later.
- Drawings: the generated Fieldwork Festival set on Silverstone map data (see Screenshots).
- Timing: the page launches with 0.2.0. Until that release is published, the button would
  offer 0.1.4, so don't enable Pages before then (building and committing it is fine).
- README: Matt's, not the build session's.

## Open questions

None.
