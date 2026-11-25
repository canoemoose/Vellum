// What the user sees when something goes wrong. Errors from the backend that a user may see
// carry a code in front of the detail, "[code] detail" (src-tauri/src/errcode.rs); the message
// comes from the code, never from matching the wording, and the detail is for the log only.
// Pure, so it's tested.

export interface ParsedError {
  /** The backend's code, or null for an error without one. */
  code: string | null;
  /** The rest of the text (for the log). */
  detail: string;
}

/** The text of whatever was thrown: a backend string, an Error's message, or a fallback. */
export function errorString(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

export function parseError(e: unknown): ParsedError {
  const s = errorString(e);
  const m = /^\[([a-z_]+)\]\s*([\s\S]*)$/.exec(s);
  return m ? { code: m[1], detail: m[2] } : { code: null, detail: s };
}

/** Whether `e` carries `code`. */
export const hasCode = (e: unknown, code: string): boolean => parseError(e).code === code;

/**
 * Messages by code. `{verb}` is what was being done ("open this file", "save the layout"), for
 * the codes that can happen to more than one action.
 */
const MESSAGES: Record<string, string> = {
  pdfium_missing: "Vellum is missing a file it needs (pdfium.dll). Reinstall Vellum.",
  pdfium_load: "Vellum couldn't start its PDF engine. Reinstall Vellum.",
  password_required: "This PDF is password protected.",
  wrong_password: "That password isn't right.",
  not_supported: "This isn't a PDF or an image Vellum can open.",
  unsupported_security: "This PDF uses a kind of security Vellum can't open.",
  open_failed: "Couldn't open this PDF. It may be damaged.",
  image_unsupported: "This image uses a format Vellum can't read yet.",
  image_damaged: "This image looks damaged and couldn't be read.",
  image_failed: "Couldn't open this image.",
  image_empty: "This image is empty.",
  not_found: "Couldn't {verb}: the file isn't there any more.",
  access_denied: "Couldn't {verb}: Windows didn't allow access.",
  in_use: "Couldn't {verb}: the file is open in another program.",
  disk_full: "Couldn't {verb}: the disk is full.",
  read_failed: "Couldn't {verb}: the file couldn't be read. It may be open in another program.",
  explorer_failed: "Couldn't open Explorer.",
  cancelled: "Cancelled.",
  // Stamps
  signature_no_ink: "Couldn't find a signature there. Crop closer round it, or try a photo in dark ink on plain paper.",
  heic_codec_missing:
    "Windows can't read this HEIC photo. Install HEIF Image Extensions and HEVC Video Extensions from the Microsoft Store, or save the photo as a JPEG.",
  signature_too_small: "That picture is too small to use.",
  signature_too_large: "That signature is too large to keep.",
  picture_too_large: "That picture is too large to read (over 100 megapixels). Shrink or crop it in another app first.",
  signature_unreadable: "This signature couldn't be read. It may have been saved by another Windows account.",
  signature_not_found: "That signature isn't in the library any more.",
  stamp_image: "Couldn't {verb}: a stamp's picture couldn't be read.",
  stamp_not_found: "That stamp isn't in the library any more.",
  stamp_too_small: "That picture is too small to use as a stamp.",
  // Stage 8: the Image tool (and a picture pasted from the clipboard)
  picture_unreadable: "Couldn't {verb}: that file isn't a picture Vellum can read.",
  recovery_unreadable: "Unsaved markups from a crash couldn't be read back.",
};

/** Text written for people, as opposed to an internal or operating-system message. */
function readable(s: string): boolean {
  return /^[A-Z]/.test(s) && !/os error|\{|\}|[A-Za-z]:\\/.test(s);
}

/** A full stop on the end, unless it already ends a sentence. */
function sentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * The message to show for `e`, which happened while trying to `verb` ("open this file"). A
 * code picks the message; text without a code is shown if it was written for people, and
 * anything else becomes "Couldn't {verb}." (the detail belongs in the log).
 */
export function userMessage(e: unknown, verb: string): string {
  const { code, detail } = parseError(e);
  if (code) {
    const m = MESSAGES[code];
    return m ? m.replace("{verb}", verb) : `Couldn't ${verb}.`;
  }
  return readable(detail) ? sentence(detail) : `Couldn't ${verb}.`;
}

// Stamps
