// Builds the homepage: copies site/ to an output folder and fills in the latest release.
//
//   node tools/build-site.mjs [--out <dir>]      (npm run site)
//
// The download button needs the installer's file name, which carries the version, so the page is
// generated at deploy time from GET /repos/canoemoose/Vellum/releases/latest. That endpoint never
// returns drafts or prereleases, the same rule the updater follows. GITHUB_TOKEN is used when set.
// If the call fails or finds no installer the build still succeeds: the button links to the
// releases page instead and a warning is logged. A broken API call must never take the page down.
//
// The hero pill's text ("Markup, measuring and signatures") comes from a line in the release
// notes: "Highlights: Markup, measuring and signatures". It is read from the newest published
// release of the same feature version (0.2.x) that has one, so patch releases needn't repeat it.
// With no such line the pill shows only "New in 0.2".
//
// When a published prerelease is newer than the latest release, a line under the download
// button offers it ("Try the 0.2.0-rc1 release candidate"). It goes when the full release is
// published. Drafts never show: only what the public can already see on GitHub.
//
// SITE_URL (the Pages workflow sets it from actions/configure-pages) makes the Open Graph image and
// page address absolute, which link previews need. Without it they stay relative, which is fine
// for looking at the page locally. Nothing here names the host, so a custom domain needs no change.
//
// Writes to site-dist/ by default (gitignored). Needs no npm packages.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = "canoemoose/Vellum";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const LIST_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`;

/** The installer among a release's assets: the `_x64-setup.exe`, never its `.sig`. */
export function pickInstaller(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((a) => typeof a?.name === "string" && a.name.endsWith("_x64-setup.exe") && a.browser_download_url) ?? null;
}

/** Bytes as Windows shows them: "6.7 MB" (1 MB = 1024 x 1024 bytes), one decimal place. */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb.toFixed(1)} MB`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** An ISO timestamp as a UK date, "14 November 2026", in UTC so the build machine's zone can't move it. */
export function formatDate(iso) {
  const d = new Date(iso ?? "");
  if (typeof iso !== "string" || Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "v0.2.0" -> "0.2.0"; null for anything that isn't a version. */
export function versionFromTag(tag) {
  const m = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(typeof tag === "string" ? tag.trim() : "");
  return m ? m[1] : null;
}

/** The line under the download button. The size is left out when it can't be read. */
const metaLine = (size) => ["Free", "Windows 10 and 11", size, "keeps itself up to date"].filter(Boolean).join(" · ");

/**
 * "0.2.1" -> "0.2": the hero pill names the feature release, so its text ("markup, measuring
 * and signatures") stays true through patch releases and changes only with the next feature one.
 */
export function featureVersion(version) {
  const m = /^(\d+)\.(\d+)\./.exec(version ?? "");
  return m ? `${m[1]}.${m[2]}` : version;
}

/**
 * What the download section says, from a release (the API's JSON) or null when the call failed.
 * Returns { ok, warning?, values } where values fills the page's {{placeholders}}.
 */
export function downloadInfo(release) {
  const fallback = (warning) => ({
    ok: false,
    warning,
    values: {
      downloadUrl: RELEASES_URL,
      downloadLabel: "Download from GitHub",
      downloadMeta: metaLine(null),
      notesUrl: RELEASES_URL,
      notesLabel: "Release notes",
      pillTag: "What's new",
      installerSize: "",
      version: "",
    },
  });
  if (!release) return fallback("no release information (the API call failed)");
  const installer = pickInstaller(release);
  if (!installer) return fallback("the latest release has no _x64-setup.exe installer");
  const version = versionFromTag(release.tag_name) ?? /^Vellum_(.+)_x64-setup\.exe$/.exec(installer.name)?.[1] ?? null;
  if (!version) return fallback(`can't read a version from tag "${release.tag_name}"`);
  const size = formatSize(installer.size);
  const date = formatDate(release.published_at);
  return {
    ok: true,
    values: {
      downloadUrl: installer.browser_download_url,
      downloadLabel: `Download Vellum ${version}`,
      downloadMeta: metaLine(size),
      notesUrl: typeof release.html_url === "string" ? release.html_url : RELEASES_URL,
      notesLabel: date ? `What's new in ${version}, released ${date}` : `What's new in ${version}`,
      pillTag: `New in ${featureVersion(version)}`,
      installerSize: size ?? "",
      version,
    },
  };
}

/**
 * The "Highlights: ..." line of a release's notes, as plain text for the hero pill: heading
 * or list marker, emphasis, links and a closing full stop stripped, cut at a word to `max` characters.
 * null when the notes have no such line.
 */
export function highlights(body, max = 60) {
  const m = /^[ \t]*(?:(?:[-*+]|#{1,6})[ \t]+)?[*_]*highlights[*_]*[ \t]*:[*_]*[ \t]*(.+)$/im.exec(typeof body === "string" ? body : "");
  if (!m) return null;
  const text = m[1]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/**
 * The pill's feature text for `version`, from the API's list of releases: the Highlights line
 * of the newest published release (no drafts, no prereleases) in the same feature version.
 * "" when there is none, which leaves the pill as just "New in 0.2".
 */
export function pillText(releases, version) {
  if (!Array.isArray(releases) || !version) return "";
  const feature = featureVersion(version);
  const found = releases
    .filter((r) => r && !r.draft && !r.prerelease && featureVersion(versionFromTag(r.tag_name)) === feature && highlights(r.body))
    .sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0))[0];
  return found ? highlights(found.body) : "";
}

/** [major, minor, patch] of a version, ignoring any pre-release part; null if it isn't one. */
function core(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether version a's numbers are higher than b's (pre-release parts ignored). */
function isAhead(a, b) {
  const x = core(a);
  const y = core(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * The release candidate to offer beside the download button: the most recently published
 * prerelease (never a draft) that has an installer and is ahead of `version`, the latest full
 * release. 0.2.0-rc1 is ahead of 0.1.4 but not of 0.2.0, so the line goes when 0.2.0 is out.
 * Returns { version, url } or null. The link is the release's own page on GitHub.
 */
export function candidate(releases, version) {
  if (!Array.isArray(releases) || !core(version)) return null;
  const found = releases
    .filter((r) => r && !r.draft && r.prerelease && pickInstaller(r) && isAhead(versionFromTag(r.tag_name), version))
    .filter((r) => typeof r.html_url === "string" && r.html_url.startsWith(`https://github.com/${REPO}/`))
    .sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0))[0];
  return found ? { version: versionFromTag(found.tag_name), url: found.html_url } : null;
}

/**
 * Keeps the page's release candidate line (between <!-- candidate:start --> and :end) when
 * there is one to offer, and removes it when there isn't. The markers never reach the page.
 */
export function fillCandidate(html, cand) {
  const block = /[ \t]*<!-- candidate:start -->([\s\S]*?)<!-- candidate:end -->\r?\n?/;
  const m = block.exec(html);
  if (!m) throw new Error("build-site: the page has no <!-- candidate:start --> block");
  return html.replace(block, cand ? m[1].replace(/^\r?\n/, "") : "");
}

/** Every {{placeholder}} value the page uses. */
export function pageValues(info, releases, base) {
  const cand = candidate(releases, info.values.version);
  return {
    ...info.values,
    pillText: pillText(releases, info.values.version),
    rcVersion: cand?.version ?? "",
    rcUrl: cand?.url ?? RELEASES_URL,
    siteUrl: base || "./",
    ogImage: `${base}img/og.png`,
  };
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Replaces every {{name}} with its escaped value. An unknown name is a bug in the page: throws. */
export function fillTemplate(html, values) {
  return html.replace(/\{\{\s*([A-Za-z]+)\s*\}\}/g, (_, name) => {
    if (!(name in values)) throw new Error(`build-site: the page uses {{${name}}}, which the build doesn't supply`);
    return escapeHtml(values[name]);
  });
}

/** "https://x.github.io/Vellum" -> "https://x.github.io/Vellum/"; "" when unset (links stay relative). */
export function siteBase(url) {
  const u = typeof url === "string" ? url.trim() : "";
  if (!/^https?:\/\//.test(u)) return "";
  return u.endsWith("/") ? u : `${u}/`;
}

/** Fetches the latest release, or returns null (with the reason logged) on any failure. */
async function fetchApi(url, token) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "vellum-site-build", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`build-site: warning: ${url} answered ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`build-site: warning: ${url} failed: ${e?.message ?? e}`);
    return null;
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outArg = process.argv.indexOf("--out");
  const out = resolve(root, outArg > 0 ? process.argv[outArg + 1] : "site-dist");
  if (out === root || !out.startsWith(root)) throw new Error(`build-site: refusing to write to ${out}`);

  const token = process.env.GITHUB_TOKEN;
  const [latest, list] = await Promise.all([fetchApi(API_URL, token), fetchApi(LIST_URL, token)]);
  const info = downloadInfo(latest);
  if (!info.ok) {
    const msg = `${info.warning}; the button links to ${RELEASES_URL}`;
    console.warn(`build-site: warning: ${msg}`);
    // An annotation on the run's summary page, so a fallback deploy doesn't go unnoticed.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Homepage download link::${msg}`);
  }

  rmSync(out, { recursive: true, force: true });
  cpSync(join(root, "site"), out, { recursive: true, filter: (src) => !src.endsWith("README.md") });

  // The icon set is the app's own; copied rather than duplicated in site/.
  const icons = join(root, "src-tauri", "icons");
  mkdirSync(join(out, "img"), { recursive: true });
  cpSync(join(icons, "source", "vellum.svg"), join(out, "img", "vellum.svg"));
  cpSync(join(icons, "32x32.png"), join(out, "img", "favicon-32.png"));
  cpSync(join(icons, "128x128@2x.png"), join(out, "img", "apple-touch-icon.png"));

  const base = siteBase(process.env.SITE_URL);
  const page = join(out, "index.html");
  const values = pageValues(info, list, base);
  if (info.ok && !values.pillText) {
    console.warn(`build-site: warning: no "Highlights:" line in the ${featureVersion(info.values.version)} release notes; the pill shows no feature text`);
  }
  const cand = candidate(list, info.values.version);
  if (cand) console.log(`build-site: offering the ${cand.version} release candidate`);
  const html = fillTemplate(fillCandidate(readFileSync(page, "utf8"), cand), values);
  writeFileSync(page, html);

  const what = info.ok ? `Vellum ${info.values.version}, ${info.values.installerSize || "size unknown"}` : "fallback link";
  console.log(`build-site: wrote ${out} (${what})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
}
