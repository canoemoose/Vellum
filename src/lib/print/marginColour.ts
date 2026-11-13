// The printable-area line's colour for canvas drawing: the `--print-margin` token (app.css), so
// the print preview and the manual layout match the rest of the UI.

const FALLBACK = "rgba(13, 148, 136, 0.55)";

export function printMargin(): string {
  if (typeof document === "undefined") return FALLBACK;
  return getComputedStyle(document.documentElement).getPropertyValue("--print-margin").trim() || FALLBACK;
}
