import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RELEASES_URL, downloadInfo, featureVersion, escapeHtml, fillTemplate, formatDate, formatSize, pickInstaller, siteBase, versionFromTag } from "./build-site.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const exe = { name: "Vellum_0.2.0_x64-setup.exe", size: 7062394, browser_download_url: "https://example.test/Vellum_0.2.0_x64-setup.exe" };
const sig = { name: "Vellum_0.2.0_x64-setup.exe.sig", size: 436, browser_download_url: "https://example.test/Vellum_0.2.0_x64-setup.exe.sig" };
const json = { name: "latest.json", size: 1322, browser_download_url: "https://example.test/latest.json" };
const release = (assets, extra = {}) => ({
  tag_name: "v0.2.0",
  published_at: "2026-11-20T00:21:57Z",
  html_url: "https://github.com/canoemoose/Vellum/releases/tag/v0.2.0",
  assets,
  ...extra,
});

describe("pickInstaller", () => {
  it("takes the setup exe, not its signature or the update file, in any order", () => {
    expect(pickInstaller(release([sig, json, exe]))).toBe(exe);
    expect(pickInstaller(release([exe, sig]))).toBe(exe);
  });
  it("finds nothing when there's no installer", () => {
    expect(pickInstaller(release([]))).toBeNull();
    expect(pickInstaller(release([sig, json]))).toBeNull();
    expect(pickInstaller({})).toBeNull();
    expect(pickInstaller(null)).toBeNull();
  });
});

describe("formatSize", () => {
  it("shows megabytes as Windows does, one decimal place", () => {
    expect(formatSize(7062394)).toBe("6.7 MB");
    expect(formatSize(12.3 * 1024 * 1024)).toBe("12.3 MB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
  });
  it("uses kilobytes for something tiny, and nothing for nonsense", () => {
    expect(formatSize(436)).toBe("1 KB");
    expect(formatSize(0)).toBeNull();
    expect(formatSize(undefined)).toBeNull();
    expect(formatSize(Number.NaN)).toBeNull();
  });
});

describe("formatDate", () => {
  it("writes a UK date in UTC", () => {
    expect(formatDate("2026-11-14T00:21:57Z")).toBe("14 November 2026");
    expect(formatDate("2026-01-01T23:59:59Z")).toBe("1 January 2026");
  });
  it("gives nothing for a missing or broken date", () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate("not a date")).toBeNull();
  });
});

describe("versionFromTag", () => {
  it("strips the v", () => {
    expect(versionFromTag("v0.2.0")).toBe("0.2.0");
    expect(versionFromTag("0.2.0")).toBe("0.2.0");
    expect(versionFromTag("v0.2.0-rc2")).toBe("0.2.0-rc2");
  });
  it("refuses anything else", () => {
    for (const bad of ["", "latest", "v1.2", null, undefined]) expect(versionFromTag(bad)).toBeNull();
  });
});

describe("downloadInfo", () => {
  it("links the installer with its version, size and notes", () => {
    const info = downloadInfo(release([sig, exe, json]));
    expect(info.ok).toBe(true);
    expect(info.values).toEqual({
      downloadUrl: exe.browser_download_url,
      downloadLabel: "Download Vellum 0.2.0",
      downloadMeta: "Free · Windows 10 and 11 · 6.7 MB · keeps itself up to date",
      notesUrl: "https://github.com/canoemoose/Vellum/releases/tag/v0.2.0",
      notesLabel: "What's new in 0.2.0, released 20 November 2026",
      pillTag: "New in 0.2",
      installerSize: "6.7 MB",
      version: "0.2.0",
    });
  });

  it("leaves out a size or date it can't read rather than failing", () => {
    const info = downloadInfo(release([{ ...exe, size: undefined }], { published_at: undefined }));
    expect(info.ok).toBe(true);
    expect(info.values.downloadMeta).toBe("Free · Windows 10 and 11 · keeps itself up to date");
    expect(info.values.notesLabel).toBe("What's new in 0.2.0");
  });

  it("reads the version from the file name when the tag isn't one", () => {
    expect(downloadInfo(release([exe], { tag_name: "latest" })).values.version).toBe("0.2.0");
  });

  const isFallback = (info) => {
    expect(info.ok).toBe(false);
    expect(info.warning).toBeTruthy();
    expect(info.values.downloadUrl).toBe(RELEASES_URL);
    expect(info.values.downloadLabel).toBe("Download from GitHub");
    expect(info.values.notesUrl).toBe(RELEASES_URL);
    expect(info.values.pillTag).toBe("What's new");
  };
  it("falls back to the releases page when the API call failed", () => isFallback(downloadInfo(null)));
  it("falls back when the release has no assets", () => isFallback(downloadInfo(release([]))));
  it("falls back when there's only a .sig", () => isFallback(downloadInfo(release([sig, json]))));
  it("falls back on an error body from the API", () => isFallback(downloadInfo({ message: "API rate limit exceeded" })));
});

describe("fillTemplate", () => {
  it("fills and escapes", () => {
    expect(fillTemplate('<a href="{{ url }}">{{label}}</a>', { url: "a?b=1&c=2", label: '<"x">' })).toBe('<a href="a?b=1&amp;c=2">&lt;&quot;x&quot;&gt;</a>');
  });
  it("throws on a placeholder the build doesn't supply", () => {
    expect(() => fillTemplate("{{nope}}", {})).toThrow(/nope/);
  });
  it("escapes quotes and apostrophes", () => {
    expect(escapeHtml(`What's "new"`)).toBe("What&#39;s &quot;new&quot;");
  });
});

describe("featureVersion", () => {
  it("keeps major and minor, so a patch release doesn't change the pill", () => {
    expect(featureVersion("0.2.0")).toBe("0.2");
    expect(featureVersion("0.2.1")).toBe("0.2");
    expect(featureVersion("1.10.3-rc1")).toBe("1.10");
  });
});

describe("siteBase", () => {
  it("ends an address with a slash, and ignores anything that isn't one", () => {
    expect(siteBase("https://canoemoose.github.io/Vellum")).toBe("https://canoemoose.github.io/Vellum/");
    expect(siteBase("https://vellum.matt-james.net/")).toBe("https://vellum.matt-james.net/");
    expect(siteBase("")).toBe("");
    expect(siteBase(undefined)).toBe("");
    expect(siteBase("vellum.matt-james.net")).toBe("");
  });
});

describe("the real page", () => {
  const html = read("site/index.html");
  const values = { ...downloadInfo(null).values, siteUrl: "./", ogImage: "img/og.png" };

  it("uses only placeholders the build fills, and none survive", () => {
    const out = fillTemplate(html, values);
    expect(out).not.toMatch(/\{\{/);
  });
  it("hard-codes no host, so a custom domain needs no change", () => {
    expect(html).not.toMatch(/github\.io/);
  });
  it("loads nothing from another site", () => {
    const srcs = [...html.matchAll(/\b(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]);
    const links = [...html.matchAll(/<link [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    for (const u of [...srcs, ...links]) expect(u).not.toMatch(/^(https?:)?\/\//);
  });
});
