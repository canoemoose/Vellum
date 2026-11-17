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
      downloadMeta: "Windows 10 and 11, 64-bit",
      notesUrl: RELEASES_URL,
      notesLabel: "Release notes",
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
      downloadMeta: ["Windows 10 and 11, 64-bit", size].filter(Boolean).join(" · "),
      notesUrl: typeof release.html_url === "string" ? release.html_url : RELEASES_URL,
      notesLabel: date ? `What's new in ${version}, released ${date}` : `What's new in ${version}`,
      version,
    },
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
async function fetchLatest(token) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "vellum-site-build", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(API_URL, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.warn(`build-site: warning: ${API_URL} answered ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`build-site: warning: ${API_URL} failed: ${e?.message ?? e}`);
    return null;
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const outArg = process.argv.indexOf("--out");
  const out = resolve(root, outArg > 0 ? process.argv[outArg + 1] : "site-dist");
  if (out === root || !out.startsWith(root)) throw new Error(`build-site: refusing to write to ${out}`);

  const info = downloadInfo(await fetchLatest(process.env.GITHUB_TOKEN));
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
  const html = fillTemplate(readFileSync(page, "utf8"), { ...info.values, siteUrl: base || "./", ogImage: `${base}img/og.png` });
  writeFileSync(page, html);

  const what = info.ok ? `Vellum ${info.values.version}, ${info.values.downloadMeta.split(" · ")[1] ?? "size unknown"}` : "fallback link";
  console.log(`build-site: wrote ${out} (${what})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
}
