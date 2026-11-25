import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RELEASES_URL, candidate, downloadInfo, fillCandidate, featureVersion, escapeHtml, fillTemplate, highlights, pageValues, pillText, formatDate, formatSize, pickInstaller, siteBase, versionFromTag } from "./build-site.mjs";

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

describe("highlights", () => {
  it("reads the Highlights line as plain text", () => {
    expect(highlights("Highlights: Markup, measuring and signatures\n\n- Added clouds")).toBe("Markup, measuring and signatures");
    expect(highlights("## 0.2.0\r\n\r\n**Highlights:** [Markup](https://x.test), `measuring` and signatures.\r\n- More")).toBe("Markup, measuring and signatures");
    expect(highlights("- highlights : Faster zoom")).toBe("Faster zoom");
    // As a headline, which is how the notes write it.
    expect(highlights("## Highlights: Markup, measuring and signatures\n\n## Added")).toBe("Markup, measuring and signatures");
    expect(highlights("# **Highlights:** Faster zoom")).toBe("Faster zoom");
    expect(highlights("## Highlights\n\nMarkup on its own line")).toBeNull();
  });
  it("gives nothing when there's no such line", () => {
    expect(highlights("- Fixed a crash\n- The highlights: are not at the start")).toBeNull();
    expect(highlights("Highlights:")).toBeNull();
    expect(highlights(null)).toBeNull();
  });
  it("cuts a long line at a word", () => {
    const out = highlights("Highlights: Markup, measuring, signatures, stamps, printing to scale and a good deal more besides", 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).toBe("Markup, measuring, signatures, stamps…");
  });
});

describe("pillText", () => {
  const rel = (tag, date, body, extra = {}) => ({ tag_name: tag, published_at: date, body, ...extra });
  const list = [
    rel("v0.2.1", "2026-12-02T10:00:00Z", "- Fixed a crash"),
    rel("v0.2.0", "2026-12-01T10:00:00Z", "Highlights: Markup, measuring and signatures\n- Lots"),
    rel("v0.3.0-rc1", "2026-12-03T10:00:00Z", "Highlights: Not out yet", { prerelease: true }),
    rel("v0.2.2", "2026-12-04T10:00:00Z", "Highlights: A draft", { draft: true }),
    rel("v0.1.4", "2026-11-14T10:00:00Z", "Highlights: The first release"),
  ];
  it("takes the line from the same feature version, so a patch release needn't repeat it", () => {
    expect(pillText(list, "0.2.1")).toBe("Markup, measuring and signatures");
    expect(pillText(list, "0.2.0")).toBe("Markup, measuring and signatures");
    expect(pillText(list, "0.1.4")).toBe("The first release");
  });
  it("lets a later patch release replace it", () => {
    const later = [rel("v0.2.3", "2026-12-05T10:00:00Z", "Highlights: Now with layers"), ...list];
    expect(pillText(later, "0.2.3")).toBe("Now with layers");
  });
  it("gives nothing without a line, a version or a list", () => {
    expect(pillText(list, "0.3.0")).toBe("");
    expect(pillText(list, "")).toBe("");
    expect(pillText(null, "0.2.0")).toBe("");
    expect(pillText({ message: "API rate limit exceeded" }, "0.2.0")).toBe("");
  });
});

describe("candidate", () => {
  const page = (tag) => `https://github.com/canoemoose/Vellum/releases/tag/${tag}`;
  const rel = (tag, date, extra = {}) => ({ tag_name: tag, published_at: date, prerelease: true, html_url: page(tag), assets: [exe], ...extra });
  const list = [
    rel("v0.2.0-rc1", "2026-11-16T20:21:44Z"),
    rel("v0.2.0-rc3", "2026-11-22T10:00:00Z", { draft: true }),
    rel("v0.1.4", "2026-11-14T00:21:57Z", { prerelease: false }),
  ];
  it("offers a published prerelease that's ahead of the latest release", () => {
    expect(candidate(list, "0.1.4")).toEqual({ version: "0.2.0-rc1", url: page("v0.2.0-rc1") });
  });
  it("takes the most recently published one", () => {
    const more = [rel("v0.2.0-rc2", "2026-11-17T02:27:10Z"), ...list];
    expect(candidate(more, "0.1.4").version).toBe("0.2.0-rc2");
  });
  it("stops once the full release is out, or a later one", () => {
    expect(candidate(list, "0.2.0")).toBeNull();
    expect(candidate(list, "0.2.1")).toBeNull();
    expect(candidate(list, "1.0.0")).toBeNull();
  });
  it("never offers a draft, a full release, one with no installer or a link off GitHub", () => {
    expect(candidate([rel("v0.2.0-rc3", "2026-11-22T10:00:00Z", { draft: true })], "0.1.4")).toBeNull();
    expect(candidate([rel("v0.2.0", "2026-11-22T10:00:00Z", { prerelease: false })], "0.1.4")).toBeNull();
    expect(candidate([rel("v0.2.0-rc1", "2026-11-16T20:21:44Z", { assets: [sig] })], "0.1.4")).toBeNull();
    expect(candidate([rel("v0.2.0-rc1", "2026-11-16T20:21:44Z", { html_url: "https://evil.test/" })], "0.1.4")).toBeNull();
  });
  it("offers nothing when the release or the list couldn't be read", () => {
    expect(candidate(list, "")).toBeNull();
    expect(candidate(null, "0.1.4")).toBeNull();
    expect(candidate({ message: "API rate limit exceeded" }, "0.1.4")).toBeNull();
  });
});

describe("fillCandidate", () => {
  const page = "<div>\n  <!-- candidate:start -->\n  <p>{{rcVersion}}</p>\n  <!-- candidate:end -->\n</div>";
  it("keeps the line when there's a candidate and drops the markers", () => {
    expect(fillCandidate(page, { version: "0.2.0-rc1", url: "x" })).toBe("<div>\n  <p>{{rcVersion}}</p>\n  </div>");
  });
  it("removes the line when there isn't", () => {
    expect(fillCandidate(page, null)).toBe("<div>\n</div>");
  });
  it("throws if the page has lost its markers", () => {
    expect(() => fillCandidate("<div></div>", null)).toThrow(/candidate/);
  });
});

describe("pageValues", () => {
  it("adds the pill text and the page's addresses", () => {
    const info = downloadInfo(release([exe]));
    const v = pageValues(info, [{ tag_name: "v0.2.0", published_at: "2026-11-20T00:21:57Z", body: "Highlights: Markup & measuring" }], "https://x.test/");
    expect(v.pillTag).toBe("New in 0.2");
    expect(v.pillText).toBe("Markup & measuring");
    expect(v.ogImage).toBe("https://x.test/img/og.png");
    expect(pageValues(downloadInfo(null), null, "")).toMatchObject({ pillTag: "What's new", pillText: "", siteUrl: "./" });
  });
});

describe("the real page", () => {
  const html = read("site/index.html");
  const values = pageValues(downloadInfo(null), null, "");

  it("uses only placeholders the build fills, and none survive", () => {
    for (const cand of [null, { version: "0.2.0-rc1", url: RELEASES_URL }]) {
      const out = fillTemplate(fillCandidate(html, cand), values);
      expect(out).not.toMatch(/\{\{|candidate:/);
      expect(out.includes("release candidate")).toBe(Boolean(cand));
    }
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
