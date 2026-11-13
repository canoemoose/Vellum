import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FILES, parseVersion, readVersion, writeVersion } from "./set-version.mjs";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

describe("parseVersion", () => {
  it("takes plain and pre-release versions, with or without a tag's v", () => {
    expect(parseVersion("0.1.1")).toBe("0.1.1");
    expect(parseVersion("v0.1.1")).toBe("0.1.1");
    expect(parseVersion("0.1.1-rc1")).toBe("0.1.1-rc1");
    expect(parseVersion("v1.20.300-beta.2")).toBe("1.20.300-beta.2");
  });
  it("refuses anything else", () => {
    for (const bad of ["", "1.2", "1.2.3.4", "v", "one", "1.2.3-", "1.2.3 ; rm", undefined]) expect(parseVersion(bad)).toBeNull();
  });
});

describe("the version files", () => {
  it("every rule finds a version in the real file, and they all agree", () => {
    const found = FILES.map((f) => readVersion(read(f.path), f.pattern));
    expect(found.every((v) => v !== null && parseVersion(v) === v)).toBe(true);
    expect(new Set(found).size).toBe(1);
  });

  it("writing changes the version and nothing else", () => {
    for (const f of FILES) {
      const before = read(f.path);
      const old = readVersion(before, f.pattern);
      const after = writeVersion(before, f.pattern, "9.8.7-rc1");
      expect(readVersion(after, f.pattern)).toBe("9.8.7-rc1");
      expect(after.length - before.length).toBe("9.8.7-rc1".length - old.length);
      expect(writeVersion(after, f.pattern, old)).toBe(before);
    }
  });

  it("doesn't touch a dependency that happens to share the version", () => {
    const lock = '{\n  "name": "vellum",\n  "version": "0.1.0",\n  "packages": {\n    "": {\n      "name": "vellum",\n      "version": "0.1.0"\n    },\n    "node_modules/x": {\n      "version": "0.1.0"\n    }\n  }\n}';
    let out = lock;
    for (const f of FILES.filter((f) => f.path === "package-lock.json")) out = writeVersion(out, f.pattern, "0.2.0");
    expect(out.match(/0\.2\.0/g)).toHaveLength(2);
    expect(out).toContain('"node_modules/x": {\n      "version": "0.1.0"');
  });

  it("throws when the version line is missing", () => {
    expect(() => writeVersion("nothing here", FILES[0].pattern, "1.0.0")).toThrow();
  });
});
