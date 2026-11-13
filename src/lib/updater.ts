// In-app updates, the part that touches the world: Tauri's updater plugin, localStorage and
// a few backend commands. Every decision it makes comes from shell/update.ts (pure, tested);
// this file only carries them out. App.svelte owns one Updater and shows its state in
// UpdateNotice.svelte and Help > About. See docs/release-pipeline-scope.md.

import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  afterCheck, afterLater, handoverOrder, makeHandover, readHandover, readUpdate, sanitiseMemory, shouldAnnounce, shouldAutoCheck,
  type UpdateMemory, type UpdateState,
} from "./shell/update";

const MEMORY_KEY = "vellum.update.v1";
/** A check that hasn't answered in this long has failed. */
const CHECK_TIMEOUT_MS = 20_000;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: nothing is remembered, which only means another check sooner.
  }
}

/**
 * The files to reopen after an update restart, front tab last, or none. Reads the note left
 * by the previous run and removes it, so it is acted on once at most. The note is a file
 * written by the backend, not localStorage: the installer step ends the process at once, and
 * the WebView's storage isn't certain to be on disk by then.
 */
export async function takeHandover(now = Date.now()): Promise<string[]> {
  try {
    const raw = await invoke<string | null>("update_take_handover");
    const h = raw ? readHandover(JSON.parse(raw), now) : null;
    return h ? handoverOrder(h) : [];
  } catch (e) {
    console.warn("update handover not read:", String(e));
    return [];
  }
}

export interface UpdaterView {
  state: UpdateState;
  /** Whether the notice is up. An update found quietly after "Later" has a state but no notice. */
  notice: boolean;
  /** The running version ("" until first asked for). */
  currentVersion: string;
  /** When a check last got an answer. */
  lastCheck: number | null;
}

export interface UpdaterOptions {
  onChange: (v: UpdaterView) => void;
  /**
   * Ask the shell to close: called once the update is downloaded, just before the installer
   * takes over. Returning false leaves everything as it was. This is where an unsaved-changes
   * prompt belongs.
   */
  readyToClose: () => Promise<boolean>;
  /** The files open now, and the one in front, to reopen after the restart. */
  openFiles: () => { paths: string[]; active: string | null };
}

export class Updater {
  private state: UpdateState = { kind: "idle" };
  private notice = false;
  private memory: UpdateMemory = sanitiseMemory(readJson(MEMORY_KEY));
  private currentVersion = "";
  private update: Update | null = null;
  private downloaded = false;
  private busy = false;

  constructor(private readonly opts: UpdaterOptions) {}

  view(): UpdaterView {
    return { state: this.state, notice: this.notice, currentVersion: this.currentVersion, lastCheck: this.memory.lastCheck };
  }

  private set(state: UpdateState, notice: boolean) {
    this.state = state;
    this.notice = notice;
    this.opts.onChange(this.view());
  }

  private remember(m: UpdateMemory) {
    this.memory = m;
    writeJson(MEMORY_KEY, m);
  }

  /** The check on start: at most once a day, and silent unless there is something new. */
  autoCheck(input: { enabled: boolean; bench: boolean; dev: boolean }): Promise<void> {
    if (!shouldAutoCheck({ ...input, lastCheck: this.memory.lastCheck, now: Date.now() })) return Promise.resolve();
    return this.check(false);
  }

  /**
   * Look for a newer version. `manual` (Help > Check for updates) always answers, with the
   * update, "You're up to date" or "Couldn't check"; the automatic check only ever speaks to
   * announce a version "Later" hasn't been pressed on.
   */
  async check(manual: boolean): Promise<void> {
    if (this.busy) return;
    const before = this.state;
    // A download or an install is under way: just bring its notice back.
    if (before.kind === "downloading" || before.kind === "installing") {
      if (manual) this.set(before, true);
      return;
    }
    this.busy = true;
    if (manual) this.set({ kind: "checking" }, true);
    try {
      if (!this.currentVersion) this.currentVersion = await getVersion();
      const found = await check({ timeout: CHECK_TIMEOUT_MS });
      this.remember(afterCheck(this.memory, Date.now()));
      const info = readUpdate(found, this.currentVersion);
      if (!found || !info) {
        found?.close().catch(() => {});
        await this.drop();
        this.set(manual ? { kind: "upToDate" } : { kind: "idle" }, manual);
        return;
      }
      if (this.update && this.update !== found) await this.drop();
      this.update = found;
      this.downloaded = false;
      this.set({ kind: "available", version: info.version }, shouldAnnounce(info.version, this.memory.later, manual));
    } catch (e) {
      // Offline, GitHub down, no release yet: the automatic check says nothing.
      console.warn("update check failed:", String((e as Error)?.message ?? e));
      if (manual) this.set({ kind: "checkFailed" }, true);
      else this.set(before, this.notice);
    } finally {
      this.busy = false;
    }
  }

  private async drop() {
    const u = this.update;
    this.update = null;
    this.downloaded = false;
    if (u) await u.close().catch(() => {});
  }

  /** "Later": quiet about this version until the next one, or until asked. */
  later() {
    const s = this.state;
    if ("version" in s) this.remember(afterLater(this.memory, s.version));
    this.set(s, false);
  }

  /** Close a notice that only reported something ("You're up to date", "Couldn't check"). */
  dismiss() {
    const s = this.state;
    this.set(s.kind === "upToDate" || s.kind === "checkFailed" || s.kind === "checking" ? { kind: "idle" } : s, false);
  }

  /** "What's new": the version's release page, in the browser. */
  async openNotes(): Promise<void> {
    const s = this.state;
    if (!("version" in s)) return;
    await invoke<void>("update_open_release_page", { version: s.version });
  }

  /**
   * "Install and restart": download (nothing is fetched before this), ask the shell to
   * close, note the open tabs, then hand over to the installer. On Windows the installer
   * step ends this process; the installer starts the new version afterwards.
   */
  async install(): Promise<void> {
    const u = this.update;
    const s = this.state;
    if (this.busy || !u || !(s.kind === "available" || s.kind === "blocked" || s.kind === "failed")) return;
    const version = s.version;
    this.busy = true;
    try {
      if (await this.blockedByOthers(version)) return;
      if (!this.downloaded) {
        let received = 0;
        let total: number | null = null;
        this.set({ kind: "downloading", version, received, total }, true);
        await u.download((ev) => {
          if (ev.event === "Started") total = ev.data.contentLength ?? null;
          else if (ev.event === "Progress") received += ev.data.chunkLength;
          else return;
          this.set({ kind: "downloading", version, received, total }, true);
        });
        this.downloaded = true;
      }
      if (!(await this.opts.readyToClose())) {
        this.set({ kind: "available", version }, true);
        return;
      }
      // Again: a window may have been opened while the download ran.
      if (await this.blockedByOthers(version)) return;
      const open = this.opts.openFiles();
      // Best effort: an update that can't note the tabs still installs.
      await invoke<void>("update_save_handover", { json: JSON.stringify(makeHandover(open.paths, open.active, Date.now())) }).catch((e) =>
        console.warn("update handover not saved:", String(e)),
      );
      this.set({ kind: "installing", version }, true);
      await u.install();
    } catch (e) {
      console.warn("update install failed:", String((e as Error)?.message ?? e));
      await invoke("update_take_handover").catch(() => {}); // the restart isn't happening: drop the note
      this.downloaded = false;
      this.set({ kind: "failed", version }, true);
    } finally {
      this.busy = false;
    }
  }

  /** The installer would close other Vellum windows without asking: say so instead. */
  private async blockedByOthers(version: string): Promise<boolean> {
    const others = await invoke<number>("update_other_instances").catch(() => 0);
    if (others > 0) this.set({ kind: "blocked", version, others }, true);
    return others > 0;
  }
}
