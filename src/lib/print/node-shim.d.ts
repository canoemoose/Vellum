// Minimal Node typings for printToPdf.test.ts (the only Node-side code in src/). The
// project doesn't depend on @types/node; this keeps svelte-check happy without adding it.

declare module "node:child_process" {
  interface Stream {
    on(ev: "data", cb: (d: string) => void): void;
  }
  interface Child {
    stdout: Stream;
    stderr: Stream;
    on(ev: "close", cb: (code: number | null) => void): void;
  }
  type Env = Record<string, string | undefined>;
  export function spawn(cmd: string, args: string[], opts: { cwd?: string; env?: Env; shell?: boolean }): Child;
  export function spawnSync(cmd: string, args: string[], opts: { env?: Env; shell?: boolean; encoding?: string }): { status: number | null };
}

declare module "node:fs" {
  export function existsSync(p: string): boolean;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:path" {
  export function join(...p: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(u: URL | string): string;
}

declare const process: { platform: string; env: Record<string, string | undefined> };
