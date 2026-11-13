#!/usr/bin/env node
// One version, written to every file that carries it, so they can't drift:
// package.json, src-tauri/tauri.conf.json and src-tauri/Cargo.toml, plus the two lockfiles
// (package-lock.json, src-tauri/Cargo.lock), which repeat it.
//
//   node tools/set-version.mjs 0.1.1          write 0.1.1 everywhere
//   node tools/set-version.mjs --check 0.1.1  exit 1 unless every file already says 0.1.1
//   node tools/set-version.mjs --check v0.1.1 the same: a leading "v" (a git tag) is ignored
//
// The release workflow runs --check against the tag, so a tag that disagrees with the files
// never becomes a release.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** MAJOR.MINOR.PATCH with an optional pre-release part ("0.1.1-rc1"). */
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

/** The version from a command-line argument or a tag: "v0.1.1" and "0.1.1" both give "0.1.1". */
export function parseVersion(arg) {
  const v = String(arg ?? "").trim().replace(/^v/, "");
  return VERSION.test(v) ? v : null;
}

/**
 * Each file's rule: `pattern` matches once, with the version as capture group 2 between
 * groups 1 and 3. Text patterns rather than a JSON or TOML round trip, so nothing else in the
 * file (key order, comments, line endings) changes.
 */
export const FILES = [
  { path: "package.json", pattern: /^(\{\s*"name": "vellum",[\s\S]*?\n  "version": ")([^"]+)(")/ },
  { path: "package-lock.json", pattern: /^(\{\s*"name": "vellum",\s*"version": ")([^"]+)(")/ },
  // The root package's own entry in the lockfile, a few lines further down.
  { path: "package-lock.json", pattern: /("packages": \{\s*"": \{\s*"name": "vellum",\s*"version": ")([^"]+)(")/ },
  { path: "src-tauri/tauri.conf.json", pattern: /("productName": "Vellum",\s*"version": ")([^"]+)(")/ },
  { path: "src-tauri/Cargo.toml", pattern: /^(\[package\]\r?\nname = "vellum"\r?\nversion = ")([^"]+)(")/ },
  { path: "src-tauri/Cargo.lock", pattern: /(\[\[package\]\]\r?\nname = "vellum"\r?\nversion = ")([^"]+)(")/ },
];

/** The version `text` carries under `pattern`, or null if the pattern doesn't match. */
export function readVersion(text, pattern) {
  return pattern.exec(text)?.[2] ?? null;
}

/** `text` with the version under `pattern` replaced; throws if the pattern doesn't match. */
export function writeVersion(text, pattern, version) {
  if (!pattern.test(text)) throw new Error("version line not found");
  return text.replace(pattern, (_, a, _old, c) => `${a}${version}${c}`);
}

function main(argv) {
  const check = argv.includes("--check");
  const args = argv.filter((a) => a !== "--check");
  const version = parseVersion(args[0]);
  if (args.length !== 1 || !version) {
    console.error("usage: node tools/set-version.mjs [--check] <version>   (for example 0.1.1 or 0.1.1-rc1)");
    return 2;
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const texts = new Map();
  const load = (p) => texts.get(p) ?? texts.set(p, readFileSync(join(root, p), "utf8")).get(p);

  let bad = 0;
  for (const { path, pattern } of FILES) {
    const found = readVersion(load(path), pattern);
    if (found === null) {
      console.error(`set-version: no version line found in ${path}`);
      bad++;
    } else if (check && found !== version) {
      console.error(`set-version: ${path} says ${found}, expected ${version}`);
      bad++;
    } else if (!check) {
      texts.set(path, writeVersion(load(path), pattern, version));
    }
  }
  if (bad) {
    if (check) console.error(`set-version: run "node tools/set-version.mjs ${version}" and commit before tagging`);
    return 1;
  }
  if (!check) for (const [p, text] of texts) writeFileSync(join(root, p), text);
  console.log(check ? `set-version: every file says ${version}` : `set-version: wrote ${version} to ${texts.size} files`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
