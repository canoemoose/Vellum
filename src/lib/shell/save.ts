// Wording and keys for saving markups. Pure. The decisions behind the warnings are in
// docs/editing-scope.md ("Decisions made", 14 November 2026).

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
