# Release pipeline: GitHub Actions build and in-app updates

Status: **scoped, decisions recorded** (13 November 2026). Nothing is built. This is the source
of truth for the work; update it as phases land.

## Objective

A tagged commit becomes an installer on a GitHub Release without anyone building by hand, and
an installed Vellum finds that release and updates itself. In place before the editing work
merges, so 0.2.0 reaches installed copies through the updater.

## How this work runs

- **Its own branch and worktree, in parallel with the editing work** (`docs/editing-scope.md`,
  branch `editing`). Suggested branch: `release-pipeline`.
- **Small and merged first.** This is days, the editing work is weeks. Merge this to `main`
  once phase 3 is done (phase 4 releases from `main`); `editing` then picks it up from `main`.
- **Keep out of the editing work's way.** The two branches both touch a few shared files
  (below). Keep changes to those minimal and put everything else in new files.
- **This work can't be tested without pushing.** Workflows only run on GitHub. Matt's standing
  rule is that pushing needs an explicit ask, so the session must ask before the first push of
  the branch and before pushing any tag. Nothing is published without Matt: releases are
  created as drafts.

## What's there today (checked)

- Version 0.1.0 in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. No
  git tags, no `.github` folder, no updater.
- Repository `canoemoose/Vellum` is **public**, default branch `main`. The updater can fetch
  releases without credentials.
- Bundle target is NSIS, per user (`installMode: currentUser`), which is what Tauri's updater
  expects on Windows.
- `beforeBuildCommand` already fetches PDFium, writes the third-party notices and builds the
  front end, so `npm run tauri build` is the whole build.
- `src-tauri/pdfium` and `test-files` are git-ignored. No test depends on `test-files`. The
  print round-trip tests skip themselves when "Microsoft Print to PDF" isn't installed.
- Node and npm are pinned with Volta in `package.json` (node 24.22.2, npm 12.2.2).
- Help > About (`AboutDialog.svelte`) already shows the version from Tauri.
- v0.1 was built on the GNU Rust toolchain. The repository is documented to build on MSVC,
  which the GitHub Windows runners have. **CI will be the first MSVC build.**

## Design

### Two workflows

- **`ci.yml`**, on every push and pull request: install, `npm run check`, `npm test`,
  `cargo test`, and a release build without bundling. Catches breakage on both branches and
  proves the MSVC toolchain.
- **`release.yml`**, on a `v*` tag: check the tag matches the version in all three files, run
  the tests, `npm run tauri build`, sign the update artefacts, and create a **draft** GitHub
  Release holding the installer, its signature and `latest.json`. Matt reads it and presses
  Publish; until then no installed copy sees it. That is the release gate.

Details:

- Order matters: `node tools/fetch-pdfium.mjs` before any test (the Rust tests need the DLL),
  and the Rust toolchain before `npm test` (it runs the print round trip through cargo).
  Install with `npm ci`; both lockfiles are committed.
- The throwaway tag in phase 2 needs the three version files set to match it on the branch
  (`0.1.1-rc1`), then set back.
- Runner `windows-latest`. Node and npm from the Volta pin (`volta-cli/action`), so CI uses
  the same versions as the desk.
- Cache cargo's build (`Swatinem/rust-cache`) and npm's download cache; a cold Tauri build is
  slow.
- Third-party actions pinned to a commit, not a moving tag. The release job is the only one
  with `contents: write`.
- `tauri-apps/tauri-action` does the build, the draft release and `latest.json`.

### Updater

- Tauri's updater plugin (`tauri-plugin-updater`, with `tauri-plugin-process` to restart),
  endpoint `https://github.com/canoemoose/Vellum/releases/latest/download/latest.json`.
  "Latest" on GitHub means the newest published, non-prerelease release, so drafts and
  prereleases are never offered.
- `bundle.createUpdaterArtifacts` on; the public key in `tauri.conf.json`; the private key and
  its password only in the repository's Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). The app refuses any update not signed by that key.
- Windows install mode "passive": the installer shows progress and needs no clicks.
- Exact option names and the plugin's permissions are to be confirmed against the current
  Tauri documentation when building; they have changed between releases.

### What the user sees

- **A quiet check on start**, at most once a day, never blocking the window or a file opening.
  A failed check (offline, GitHub down) says nothing.
- **When there's an update:** a small notice, not a dialog: "Vellum 0.2.0 is available", with
  "Install and restart", "What's new" (the release notes) and "Later". "Later" stays quiet
  until the next version or the next manual check.
- **Help > Check for updates** for a check on demand, which does answer "You're up to date".
  The About dialog shows the same state.
- **Nothing downloads until asked.** The installer is fetched on "Install and restart", with
  progress shown.
- **A setting** to turn the automatic check off. The check is one request to GitHub and sends
  nothing about the user or their files; say so beside the setting.
- **Restarting** reopens the tabs that were open. Vellum doesn't restore tabs on start today,
  so this is new: note the open files just before the restart and reopen them once after it
  (a one-off hand-over, not a general "restore last session" feature).
- **Other Vellum windows** (`--new-instance`) keep the exe in use and block the installer:
  check what the installer does then, and say "close other Vellum windows" if it can't proceed.
- Once the editing work lands, "Install and
  restart" must go through the same unsaved-changes prompt as closing the window. Write the
  restart as "ask the shell to close, then install", so that prompt applies when it exists.
- Benchmark runs (`--bench`) never check.

### Versions

- One script, `tools/set-version.mjs <version>`, writes all three files, so they can't drift.
  The release workflow fails if the tag and the files disagree.
- **0.1.0 has no updater**, so anyone on it installs the next version by hand once.
- **0.1.1** is the first release from the pipeline and the first with the updater.
- **0.1.2** is a trivial follow-up whose only purpose is to prove 0.1.1 updates to it.
- **0.2.0** is the editing work, delivered through the updater.

### Supply chain

- `tools/fetch-pdfium.mjs` downloads a prebuilt DLL from another project's releases at build
  time. Pin its SHA-256 in the script and fail on a mismatch, now that builds run unattended
  and ship to users.
- The updater's private key is the one thing that can push code to every installed copy.
  It lives in Actions secrets and Matt's password manager, nowhere else, and is never
  committed. If it's lost, installed copies can't be updated and need a manual reinstall.

## Out of scope

- **Windows code signing.** Without a certificate, SmartScreen warns on the first download of
  an installer. Updates through the updater aren't affected. A certificate is a recurring
  cost and an identity check; decide separately.
- Other platforms, beta channels, delta updates, rollback, telemetry.

## Phases

1. **CI.** `ci.yml`; fix whatever the first MSVC build turns up. *Needs a push of the branch.*
2. **Release build.** `release.yml`, `tools/set-version.mjs`, the PDFium checksum. Prove it
   with a throwaway prerelease tag (for example `v0.1.1-rc1`) that produces a draft release,
   then delete the draft and the tag.
3. **Updater.** Plugin, configuration, key pair (Matt generates it), the notice, the Help
   item, the setting, About. Pure logic (when to check, what "later" means, version
   comparison) in `src/lib/shell/update.ts` with Vitest tests.
4. **Prove it end to end.** Merge to `main`, tag and publish 0.1.1, install it; tag and
   publish 0.1.2; confirm 0.1.1 offers it, installs it and comes back with its tabs.
5. **Docs.** A "Releasing" section in `CLAUDE.md` (the commands, in order) and a line in the
   README about updates.

## Files in play

New, no conflict with the editing branch:

- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- `tools/set-version.mjs`
- `src/lib/shell/update.ts` and its test
- `src/lib/components/UpdateNotice.svelte`

Shared with the editing branch, keep changes small:

- `src-tauri/tauri.conf.json` (updater configuration; editing shouldn't need it)
- `src-tauri/Cargo.toml` (two plugin lines; editing adds its own crates)
- `package.json` (two plugin packages)
- `src-tauri/src/lib.rs` (plugin registration), `src-tauri/capabilities/default.json`
- `src/App.svelte` (mount the notice, one menu action), `MenuBar` items, `AboutDialog.svelte`,
  `src/lib/settings.ts` (one setting)
- `tools/fetch-pdfium.mjs` (checksum)

## Testing

- **Automated:** the update logic in Vitest (check interval, "later", version ordering, a
  malformed `latest.json`). The workflows test themselves by running.
- **For Matt:** phase 4, on a real machine: the notice's look and wording, the install, the
  restart. Also one install on a machine that has never had Vellum, to see what SmartScreen
  says.

## Needs from Matt

1. **Permission to push** the `release-pipeline` branch and test tags, when the session asks.
2. **The updater key pair**, generated once on your machine (the session will give the
   command), with the private key and password added to the repository's Actions secrets and
   saved in your password manager.
3. **Publishing** the 0.1.1 and 0.1.2 releases, and installing them for the end-to-end check.

## Decisions (Matt, 13 November 2026)

- **Checking:** a quiet daily check on start, plus Help > Check for updates, as designed above.
- **Proving releases:** 0.1.1 and 0.1.2 are published as real releases.
- **Code signing:** not now; SmartScreen stays as it is.

## Open questions

None.
