// Runs the Rust end-to-end print test (src-tauri/tests/print_gdi.rs) from `npm test`:
// compose a job, print it to "Microsoft Print to PDF", open the PDF the driver writes with
// PDFium and check page count, sizes and where the content landed.
//
// Skips cleanly when it can't run: not Windows, no cargo, the printer isn't installed, or
// VELLUM_SKIP_PRINT_TEST=1. The first run compiles the Rust tests, which takes minutes;
// set CARGO_TARGET_DIR to a shared target dir to reuse an existing build.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const tauriDir = fileURLToPath(new URL("../../../src-tauri", import.meta.url));

type Env = Record<string, string | undefined>;

function env(): Env {
  const e = { ...process.env };
  // This machine's GNU toolchain needs its MinGW on PATH (CLAUDE.md, toolchain notes).
  const mingw = join(homedir(), ".vellum-toolchain", "mingw64", "bin");
  const cargoBin = join(homedir(), ".cargo", "bin");
  const extra = [mingw, cargoBin].filter((p) => existsSync(p));
  const key = Object.keys(e).find((k) => k.toLowerCase() === "path") ?? "PATH";
  e[key] = [...extra, e[key] ?? ""].join(";");
  return e;
}

function cargoAvailable(e: Env): boolean {
  const r = spawnSync("cargo", ["--version"], { env: e, shell: true, encoding: "utf8" });
  return r.status === 0;
}

const skipReason =
  process.platform !== "win32"
    ? "not Windows"
    : process.env.VELLUM_SKIP_PRINT_TEST === "1"
      ? "VELLUM_SKIP_PRINT_TEST=1"
      : !cargoAvailable(env())
        ? "cargo not found"
        : null;

describe("printing to Microsoft Print to PDF (Rust, tests/print_gdi.rs)", () => {
  it.skipIf(skipReason !== null)(
    `composes, prints and checks the output${skipReason ? ` (skipped: ${skipReason})` : ""}`,
    async (ctx) => {
      const out = await new Promise<{ code: number | null; text: string }>((done) => {
        const p = spawn("cargo", ["test", "--test", "print_gdi", "--", "--nocapture", "--test-threads=1"], {
          cwd: tauriDir,
          env: env(),
          shell: true,
        });
        let text = "";
        p.stdout.on("data", (d) => (text += d));
        p.stderr.on("data", (d) => (text += d));
        p.on("close", (code) => done({ code, text }));
      });
      if (out.text.includes("SKIP:")) {
        ctx.skip("Microsoft Print to PDF is not installed");
        return;
      }
      if (out.code !== 0) console.error(out.text.slice(-4000));
      expect(out.code).toBe(0);
      expect(out.text).toMatch(/test result: ok\. 4 passed/);
    },
    30 * 60 * 1000,
  );
});
