// In-app updates: everything that can be decided without the window or the network. When to
// check, what "Later" means, which version is newer, what an update reply must look like, the
// tabs handed across the restart, and the words shown. Pure, so it's tested; App.svelte and
// UpdateNotice.svelte wire it to Tauri's updater plugin (docs/release-pipeline-scope.md).

/** The automatic check runs at most this often. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Tabs noted before an update restart are reopened only if the restart follows this soon. */
export const HANDOVER_MAX_AGE_MS = 10 * 60 * 1000;

// ------------------------------------------------------------------ versions

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers ("rc1", or "beta" and "2" for beta.2); empty for a release. */
  pre: string[];
}

/** "0.1.2", "v0.1.2" or "0.2.0-rc1" (build metadata after "+" is ignored); null for anything else. */
export function parseVersion(s: unknown): Version | null {
  if (typeof s !== "string") return null;
  const m = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(s.trim());
  if (!m) return null;
  const pre = m[4] ? m[4].split(".") : [];
  if (pre.some((p) => p === "")) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

/** Semantic-version order: negative when a is older than b, 0 when equal, positive when newer. */
export function compareVersions(a: Version, b: Version): number {
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] - b[k];
  // A release is newer than any of its pre-releases.
  if (!a.pre.length || !b.pre.length) return (a.pre.length ? 0 : 1) - (b.pre.length ? 0 : 1);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (nx !== ny) {
      return nx ? -1 : 1; // numbers sort before words
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Whether `candidate` is a newer version than `current`. False if either can't be read. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return !!a && !!b && compareVersions(a, b) > 0;
}

// ------------------------------------------------------------------ the update on offer

export interface UpdateInfo {
  /** The version on offer, without a leading "v". */
  version: string;
}

/**
 * What the updater reported, checked before anything is shown: there must be a readable
 * version and it must be newer than the one running. The plugin has already validated
 * latest.json and compared versions; this is the second lock, so a malformed or mistaken
 * reply can never put up a notice or offer a downgrade.
 */
export function readUpdate(raw: unknown, currentVersion: string): UpdateInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as { version?: unknown }).version;
  if (typeof v !== "string" || !parseVersion(v) || !isNewer(v, currentVersion)) return null;
  return { version: v.trim().replace(/^v/, "") };
}

// ------------------------------------------------------------------ what's remembered

/** Kept between runs, in its own localStorage entry (not a user setting). */
export interface UpdateMemory {
  /** When a check last got an answer (ms since epoch); null if never. */
  lastCheck: number | null;
  /** The version "Later" was pressed on; that version isn't announced again unless asked. */
  later: string | null;
}

export const NO_MEMORY: UpdateMemory = { lastCheck: null, later: null };

export function sanitiseMemory(raw: unknown): UpdateMemory {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    lastCheck: typeof s.lastCheck === "number" && Number.isFinite(s.lastCheck) && s.lastCheck > 0 ? s.lastCheck : null,
    later: typeof s.later === "string" && parseVersion(s.later) ? s.later : null,
  };
}

// ------------------------------------------------------------------ when to check, when to say

export interface AutoCheckInput {
  /** The "Check for updates automatically" setting. */
  enabled: boolean;
  /** A benchmark run (--bench): never checks. */
  bench: boolean;
  /** A development build: only checks when asked. */
  dev: boolean;
  lastCheck: number | null;
  now: number;
}

/** Whether to check on start: allowed, and a day since the last answer (or a clock set back). */
export function shouldAutoCheck(i: AutoCheckInput): boolean {
  if (!i.enabled || i.bench || i.dev) return false;
  if (i.lastCheck === null) return true;
  return i.lastCheck > i.now || i.now - i.lastCheck >= CHECK_INTERVAL_MS;
}

/**
 * Whether a found update is announced. A check the user asked for always answers; the
 * automatic one stays quiet about the version "Later" was pressed on.
 */
export function shouldAnnounce(version: string, later: string | null, manual: boolean): boolean {
  return manual || later === null || later !== version;
}

/** Memory after a check that got an answer (an update, or none). */
export function afterCheck(m: UpdateMemory, now: number): UpdateMemory {
  return { ...m, lastCheck: now };
}

/** Memory after "Later" on `version`. */
export function afterLater(m: UpdateMemory, version: string): UpdateMemory {
  return { ...m, later: version };
}

// ------------------------------------------------------------------ tabs across the restart

/** The open files noted just before an update restarts Vellum. */
export interface Handover {
  paths: string[];
  /** The file whose tab was in front, or null. */
  active: string | null;
  /** When it was written (ms since epoch). */
  t: number;
}

export function makeHandover(paths: string[], active: string | null, now: number): Handover {
  return { paths: [...paths], active: active !== null && paths.includes(active) ? active : null, t: now };
}

/**
 * The handover to act on at start, or null: it must be well formed, hold at least one file
 * and be recent. An old one (an update that never restarted, a restart hours later) is
 * dropped, so this never turns into "restore the last session".
 */
export function readHandover(raw: unknown, now: number): Handover | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!Array.isArray(s.paths) || typeof s.t !== "number" || !Number.isFinite(s.t)) return null;
  const paths = s.paths.filter((p): p is string => typeof p === "string" && p.length > 0);
  if (!paths.length || s.t > now || now - s.t > HANDOVER_MAX_AGE_MS) return null;
  return { paths, active: typeof s.active === "string" && paths.includes(s.active) ? s.active : null, t: s.t };
}

/** The order to open a handover's files in: as they were, the one in front last so it ends up in front. */
export function handoverOrder(h: Handover): string[] {
  return h.active === null ? h.paths : [...h.paths.filter((p) => p !== h.active), h.active];
}

// ------------------------------------------------------------------ state and words

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  /** A check the user asked for couldn't get an answer. */
  | { kind: "checkFailed" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; received: number; total: number | null }
  /** Downloaded; the installer is about to take over. */
  | { kind: "installing"; version: string }
  /** Other Vellum windows are open; the installer would close them without asking. */
  | { kind: "blocked"; version: string; others: number }
  | { kind: "failed"; version: string };

/** Download progress as a whole percentage, or null while the size isn't known. */
export function progressPercent(received: number, total: number | null): number | null {
  if (total === null || !(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)));
}

/** The line the notice and Help > About show for a state; null when there's nothing to say. */
export function stateText(s: UpdateState, currentVersion: string): string | null {
  switch (s.kind) {
    case "idle":
      return null;
    case "checking":
      return "Checking for updates…";
    case "upToDate":
      return currentVersion ? `You're up to date. Vellum ${currentVersion} is the latest version.` : "You're up to date.";
    case "checkFailed":
      return "Couldn't check for updates. Check your internet connection and try again.";
    case "available":
      return `Vellum ${s.version} is available`;
    case "downloading": {
      const p = progressPercent(s.received, s.total);
      return p === null ? `Downloading Vellum ${s.version}…` : `Downloading Vellum ${s.version}: ${p}%`;
    }
    case "installing":
      return `Installing Vellum ${s.version}. Vellum will restart.`;
    case "blocked":
      return s.others === 1
        ? "Another Vellum window is open. Close it, then try again: updating would close it without asking."
        : `${s.others} other Vellum windows are open. Close them, then try again: updating would close them without asking.`;
    case "failed":
      return `Couldn't install Vellum ${s.version}. Nothing has changed; try again later.`;
  }
}

/** "Last checked today", "yesterday", "12 days ago"; null if never. */
export function lastCheckedText(lastCheck: number | null, now: number): string | null {
  if (lastCheck === null) return null;
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const days = day(now) - day(lastCheck);
  if (days <= 0) return "Last checked today";
  if (days === 1) return "Last checked yesterday";
  return `Last checked ${days} days ago`;
}
