# Release candidates that update to newer release candidates: scope

Status: scoped 24 Nov 2026, nothing built. Asked for by Matt while the homepage gained a
"Try the release candidate" line: once strangers can install an RC, it should not strand them.

## Objective

A copy installed from a release candidate (0.2.0-rc1) is offered the next published release
candidate (0.2.0-rc2) and, when it is out, the full release (0.2.0). A copy installed from a
full release is never offered a release candidate. Same signed, in-app update as today.

## How it works now

- Every installed copy checks one address, set in `src-tauri/tauri.conf.json`:
  `https://github.com/canoemoose/Vellum/releases/latest/download/latest.json`.
- GitHub's "latest" never points at a prerelease, so that file always describes the newest
  full release.
- So an RC copy is offered nothing until the full release is published. It is then offered
  it, because 0.2.0 is newer than any 0.2.0-rcN. To move between RCs a tester installs by hand.
- The release workflow (`.github/workflows/release.yml`) already builds and signs a
  `latest.json` for every tag, RCs included, and marks an RC's draft as a prerelease.
- The check itself is `check()` from the updater plugin, called in `src/lib/updater.ts`. It
  takes no address: it uses the one in the config.

## Constraints

- A full-release copy must never see an RC. This is the property not to break.
- Updates stay signed with the same key. Nothing here touches the key or the public half in
  `tauri.conf.json`.
- Only published releases count. A draft RC (as rc2 and rc3 are today) is offered to nobody.
- No new service to run: GitHub Releases and Actions only.
- RCs already built (rc1 to rc3) have the full-release address baked in and cannot be moved.
  The first RC built after this lands is the first that updates to another RC.

## Approach (recommended): an RC channel file, and RC builds that read it

1. **A channel file.** One fixed address that always holds the `latest.json` of the newest
   published release of any kind, RC or full:
   `https://github.com/canoemoose/Vellum/releases/download/rc-channel/latest.json`
   (a release tagged `rc-channel`, marked prerelease so it is never "latest", holding that one
   file and a line of text saying what it is).
2. **A small workflow keeps it current.** On a release being published (full or prerelease),
   pick the newest published release by version, download its `latest.json` and replace the
   channel release's copy. The picking is a Node script with unit tests
   (`tools/rc-channel.mjs`); the workflow only runs it and uploads.
3. **RC builds read the channel.** In `release.yml`, when the tag has a pre-release part, build
   with the updater address overridden to the channel file (a `--config` overlay passed to
   tauri-action). Full-release builds are unchanged and keep the "latest" address.

Why this works without app code: the updater offers whatever the file describes if its version
is higher than the running one, and rc1 < rc2 < 0.2.0. A copy on the full release reads only
"latest", so it never sees an RC. An RC copy moves along the channel and lands on the full
release, after which it reads "latest" like everyone else.

### Considered and not chosen

- **Decide at run time in the app** (an RC copy asks the GitHub API for the newest release and
  checks that). More flexible, and the only route to a "get release candidates" setting for
  full-release users, but `check()` cannot be given an address from the front end, so the
  check, download and install would have to move into Rust. Much more to build and to test.
- **Serve the channel file from the homepage** (the site build already reads the release
  list). Ties updates to GitHub Pages being enabled and to a site rebuild on every release.

## Files in play

- `.github/workflows/release.yml`: the address override for RC tags.
- `.github/workflows/rc-channel.yml` (new): runs on `release: published`.
- `tools/rc-channel.mjs` and `tools/rc-channel.test.mjs` (new): pick the newest published
  release; pure, tested.
- `CLAUDE.md` (Releasing) and `docs/release-pipeline-scope.md`: how RCs update, and that an RC
  must be published to be offered.
- Not expected to change: `src-tauri/tauri.conf.json`, `src/lib/updater.ts`,
  `src-tauri/src/update.rs`. "What's new" already builds the right page for an RC version.

## Steps

1. Write and test the picker (`tools/rc-channel.mjs`): newest published release by version,
   full release beats its own RCs, drafts and the channel release itself ignored.
2. Create the `rc-channel` release by hand once (prerelease, one line of text).
3. Add `rc-channel.yml`. Third-party actions pinned to commits, as elsewhere.
4. Add the RC-only address override to `release.yml`.
5. Prove it with throwaway versions: publish 0.2.0-rc4, install it, publish 0.2.0-rc5, check
   rc4 is offered rc5 and a 0.1.4 copy is offered nothing.
6. Update `CLAUDE.md` and `docs/release-pipeline-scope.md`.

## Done looks like

- An installed rcN offers rcN+1 within a minute or so of it being published, installs it and
  restarts as a full release does.
- An installed full release is not offered an RC. Checked on a real copy, not by reading code.
- Publishing the full release moves RC copies onto it.
- `npm test` covers the picker; the workflows are proved by step 5.

## Open questions

1. Should an RC copy say so anywhere (Help > About, the title bar)? Today only the version
   number shows it.
2. Should people on a full release be able to opt in to RCs? That needs the run-time approach
   above and is out of scope here.
3. GitHub serves a replaced file from cache for up to a minute or so (the same delay noted for
   "latest"). Acceptable?
4. Does a `--config` overlay passed through tauri-action reach the updater address as
   expected? To confirm in step 4 before relying on it; the fallback is patching
   `tauri.conf.json` in the workflow for RC tags only.
