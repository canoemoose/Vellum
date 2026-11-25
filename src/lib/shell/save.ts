// Wording and keys for saving markups. Pure. The decisions behind the warnings are in
// docs/editing-scope.md ("Decisions made", 14 November 2026).

import { outsideWinAnsi } from "../markup/fonts";

/** What annot_inspect reports about a file (src-tauri/src/annot/writer.rs, FileInfo). */
export interface FileInfo {
  bytes: number;
  objects: number;
  pages: number;
  xrefStream: boolean;
  encryption: string | null;
  permissions: number | null;
  recovered: boolean;
  signatures: number;
  docmdp: number | null;
  loadMs: number;
}

/** A file's size and modification time (file_stamp). */
export interface Stamp {
  size: number;
  mtimeMs: number;
}

export interface SaveConfirmation {
  /** The save appends to the file, or (malformed files) rewrites it. */
  kind: "append" | "rewrite";
  message: string;
  warnings: string[];
  note: string | null;
}

/** "Comments may be added" is bit 6 (value 32) of /P (ISO 32000-1, table 22). */
export function forbidsComments(info: FileInfo): boolean {
  return info.encryption !== null && info.permissions !== null && (info.permissions & 32) === 0;
}

// Existing annotations (phase 7b)

/** "Modify the contents" is bit 4 (value 8) of /P; "comments" bit 6 (32). */
export function forbidsChanges(info: FileInfo): boolean {
  return info.encryption !== null && info.permissions !== null && ((info.permissions & 8) === 0 || (info.permissions & 32) === 0);
}

/**
 * What to say before "Edit file" is switched on, if anything (docs/editing-scope.md, "The edit
 * lock"): the file is signed or certified, or its permissions ask for no changes. Empty when
 * there's nothing to say; unlocking then goes ahead without asking.
 */
export function unlockWarnings(name: string, info: FileInfo | null): string[] {
  if (!info) return [];
  const out: string[] = [];
  if (info.docmdp === 1 || info.docmdp === 2) out.push(`${name} is certified (${info.docmdp === 1 ? "no changes allowed" : "form filling only"}): saving changes to it breaks the certification.`);
  else if (info.signatures > 0) out.push(`${name} is signed: changing what it was signed with makes other apps report the signature as invalid.`);
  if (forbidsChanges(info)) out.push(`${name}'s permissions ask for it not to be changed.`);
  return out;
}

/** The first-save confirmation for a file. */
export function saveConfirmation(name: string, info: FileInfo): SaveConfirmation {
  const kind = info.recovered ? "rewrite" : "append";
  const message =
    kind === "rewrite"
      ? `Save your markups into ${name}? This file has errors; saving rewrites it.`
      : `Save your markups into ${name}? They're added to the end of the file; nothing already in it changes.`;
  const warnings: string[] = [];
  if (info.docmdp === 1 || info.docmdp === 2) {
    warnings.push(
      `${name} is certified (${info.docmdp === 1 ? "no changes allowed" : "form filling only"}). Adding markups breaks the certification: other apps will report it as invalid.`,
    );
  }
  if (forbidsComments(info)) warnings.push(`${name}'s permissions say comments shouldn't be added to it.`);
  let note: string | null = null;
  if (info.signatures > 0 && !(info.docmdp === 1 || info.docmdp === 2)) {
    note = "The file is signed. Each signature stays valid for the version it signed; your markups show as changes made after signing.";
  }
  return { kind, message, warnings, note };
}

/** A recovery file's key for a file's pathKey: FNV-1a over UTF-16, as hex, safe as a file name. */
export function recoveryKey(pathKey: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < pathKey.length; i++) {
    const c = pathKey.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193 + 2 * i + 1) >>> 0;
  }
  return `m-${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** The question when closing with unsaved markups. */
export function unsavedMessage(names: string[]): string {
  if (names.length === 1) return `Save your markups on ${names[0]} before closing?`;
  const list = names.length <= 4 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return `${names.length} files have unsaved markups: ${list}. Save them before closing?`;
}

/** A suggested name for "Save a copy". */
export function copyName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "drawing.pdf";
  const dot = name.toLowerCase().endsWith(".pdf") ? name.length - 4 : name.length;
  return `${name.slice(0, dot)} (marked up).pdf`;
}

// Stamps

/** The question on the first save after placing signatures: bake them in, or keep them movable. */
export interface BakeQuestion {
  title: string;
  message: string;
  /** The buttons, the safer one first (it's the default). */
  keep: string;
  bake: string;
}

export function bakeQuestion(count: number, copy: boolean): BakeQuestion {
  const one = count === 1;
  const it = one ? "it" : "them";
  const where = copy ? "the copy's page" : "the page";
  return {
    title: one ? "Bake in the signature?" : `Bake in ${count} signatures?`,
    message:
      `Bake ${one ? "the signature you placed" : `the ${count} signatures you placed`} into ${where}, or keep ${it} movable? ` +
      `Baked in, ${one ? "it becomes" : "they become"} part of the drawing and can't be moved or lifted off; once saved, that can't be undone. ` +
      `Movable, ${one ? "it stays a stamp" : "they stay stamps"} that can be moved or deleted later, here or in another PDF editor.`,
    keep: "Keep movable",
    bake: "Bake in",
  };
}

/** The ids of signatures placed since the last save: the ones the bake question is about. */
export function newSignatureIds(saved: { id: string }[], current: { id: string; kind: string; signature?: boolean }[]): string[] {
  const before = new Set(saved.map((m) => m.id));
  return current.filter((m) => m.kind === "stamp" && m.signature === true && !before.has(m.id)).map((m) => m.id);
}

/** A save's changes with the chosen signatures baked in instead of added as annotations. */
export function withBakes<C extends { op: string; spec?: { nm: string } }>(changes: C[], bake: ReadonlySet<string>): (C | { op: "bake"; spec: NonNullable<C["spec"]> })[] {
  if (!bake.size) return changes;
  return changes.map((c) => (c.op === "add" && c.spec && bake.has(c.spec.nm) ? { op: "bake" as const, spec: c.spec } : c));
}

/** Subtypes whose text is only in /Contents, never drawn in the appearance (notes, text marks). */
const UNDRAWN_TEXT = new Set(["Text", "Highlight", "Underline", "StrikeOut", "Squiggly"]);

/**
 * A line for the "Saved" message when a save draws text WinAnsi can't hold (Δ, Ω, ≥, CJK): other
 * PDF apps show those as "?" in the markup, though its /Contents (and Vellum) keep them
 * (fonts.ts toWinAnsi; docs/review-0.2.0.md, 12). Null when there's nothing to say.
 */
export function winAnsiNote(changes: readonly { op: string; spec?: { subtype: string; contents?: string | null } }[]): string | null {
  const chars: string[] = [];
  for (const c of changes) {
    if ((c.op !== "add" && c.op !== "replace" && c.op !== "bake") || !c.spec?.contents || UNDRAWN_TEXT.has(c.spec.subtype)) continue;
    for (const ch of outsideWinAnsi(c.spec.contents)) if (!chars.includes(ch)) chars.push(ch);
  }
  if (!chars.length) return null;
  const shown = chars.slice(0, 5).join(" ") + (chars.length > 5 ? " …" : "");
  return `Other PDF apps show ${shown} as "?" in these markups; Vellum shows them as typed.`;
}
