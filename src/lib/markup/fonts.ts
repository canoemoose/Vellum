// The standard PDF text fonts (Helvetica, Times, Courier, each plain, bold, italic and bold
// italic): built into every PDF reader, so nothing is embedded. Their widths, line breaking
// with them, and how each is named in a PDF and shown on screen. The overlay and the saved
// appearance share this, so a text box wraps the same in both.
//
// Widths are in 1/1000 em for the WinAnsi bytes 32..255 (0 where WinAnsi has no character).
// They were measured from Windows' Arial, Times New Roman and Courier New, which were made to
// the same widths as Helvetica, Times and Courier: the ASCII range matches Adobe's AFM files
// exactly (checked), and the screen draws in those fonts, so screen and file wrap alike. Italic
// Helvetica and every Courier share their upright widths, as in the AFMs. Pure.

export type Family = "helvetica" | "times" | "courier";

export interface Face {
  family: Family;
  bold: boolean;
  italic: boolean;
}

export const HELVETICA: Face = { family: "helvetica", bold: false, italic: false };

const W = {
  helvetica: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
    556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
    0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 552,
    400, 549, 333, 333, 333, 576, 537, 333, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 549, 611, 556, 556, 556, 556, 500, 556, 500,
  ],
  helveticaBold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
    556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
    0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 552,
    400, 549, 333, 333, 333, 576, 556, 333, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
    611, 611, 611, 611, 611, 611, 611, 549, 611, 611, 611, 611, 611, 556, 611, 556,
  ],
  times: [
    250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444,
    921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722,
    556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500,
    333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500,
    500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541, 0,
    500, 0, 333, 500, 444, 1000, 500, 500, 333, 1000, 556, 333, 889, 0, 611, 0,
    0, 333, 333, 444, 444, 350, 500, 1000, 333, 980, 389, 333, 722, 0, 444, 722,
    250, 333, 500, 500, 500, 500, 200, 500, 333, 760, 276, 500, 564, 333, 760, 500,
    400, 549, 300, 300, 333, 576, 453, 333, 333, 300, 310, 500, 750, 750, 750, 444,
    722, 722, 722, 722, 722, 722, 889, 667, 611, 611, 611, 611, 333, 333, 333, 333,
    722, 722, 722, 722, 722, 722, 722, 564, 722, 722, 722, 722, 722, 722, 556, 500,
    444, 444, 444, 444, 444, 444, 667, 444, 444, 444, 444, 444, 278, 278, 278, 278,
    500, 500, 500, 500, 500, 500, 500, 549, 500, 500, 500, 500, 500, 500, 500, 500,
  ],
  timesBold: [
    250, 333, 555, 500, 500, 1000, 833, 278, 333, 333, 500, 570, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
    930, 722, 667, 722, 722, 667, 611, 778, 778, 389, 500, 778, 667, 944, 722, 778,
    611, 778, 722, 556, 667, 722, 722, 1000, 722, 722, 667, 333, 278, 333, 581, 500,
    333, 500, 556, 444, 556, 444, 333, 500, 556, 278, 333, 556, 278, 833, 556, 500,
    556, 556, 444, 389, 333, 556, 500, 722, 500, 500, 444, 394, 220, 394, 520, 0,
    500, 0, 333, 500, 500, 1000, 500, 500, 333, 1000, 556, 333, 1000, 0, 667, 0,
    0, 333, 333, 500, 500, 350, 500, 1000, 333, 1000, 389, 333, 722, 0, 444, 722,
    250, 333, 500, 500, 500, 500, 220, 500, 333, 747, 300, 500, 570, 333, 747, 500,
    400, 549, 300, 300, 333, 576, 540, 333, 333, 300, 330, 500, 750, 750, 750, 500,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 389, 389, 389, 389,
    722, 722, 778, 778, 778, 778, 778, 570, 778, 722, 722, 722, 722, 722, 611, 556,
    500, 500, 500, 500, 500, 500, 722, 444, 444, 444, 444, 444, 278, 278, 278, 278,
    500, 556, 500, 500, 500, 500, 500, 549, 500, 556, 556, 556, 556, 500, 556, 500,
  ],
  timesItalic: [
    250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500,
    920, 611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722,
    611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556, 389, 278, 389, 422, 500,
    333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500,
    500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541, 0,
    500, 0, 333, 500, 556, 889, 500, 500, 333, 1000, 500, 333, 944, 0, 556, 0,
    0, 333, 333, 556, 556, 350, 500, 889, 333, 980, 389, 333, 667, 0, 389, 556,
    250, 389, 500, 500, 500, 500, 275, 500, 333, 760, 276, 500, 675, 333, 760, 500,
    400, 549, 300, 300, 333, 576, 523, 250, 333, 300, 310, 500, 750, 750, 750, 500,
    611, 611, 611, 611, 611, 611, 889, 667, 611, 611, 611, 611, 333, 333, 333, 333,
    722, 667, 722, 722, 722, 722, 722, 675, 722, 722, 722, 722, 722, 556, 611, 500,
    500, 500, 500, 500, 500, 500, 667, 444, 444, 444, 444, 444, 278, 278, 278, 278,
    500, 500, 500, 500, 500, 500, 500, 549, 500, 500, 500, 500, 500, 444, 500, 444,
  ],
  timesBoldItalic: [
    250, 389, 555, 500, 500, 833, 778, 278, 333, 333, 500, 570, 250, 333, 250, 278,
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 570, 570, 570, 500,
    832, 667, 667, 667, 722, 667, 667, 722, 778, 389, 500, 667, 611, 889, 722, 722,
    611, 722, 667, 556, 611, 722, 667, 889, 667, 611, 611, 333, 278, 333, 570, 500,
    333, 500, 500, 444, 500, 444, 333, 500, 556, 278, 278, 500, 278, 778, 556, 500,
    500, 500, 389, 389, 278, 556, 444, 667, 500, 444, 389, 348, 220, 348, 570, 0,
    500, 0, 333, 500, 500, 1000, 500, 500, 333, 1000, 556, 333, 944, 0, 611, 0,
    0, 333, 333, 500, 500, 350, 500, 1000, 333, 1000, 389, 333, 722, 0, 389, 611,
    250, 389, 500, 500, 500, 500, 220, 500, 333, 747, 266, 500, 606, 333, 747, 500,
    400, 549, 300, 300, 333, 576, 500, 250, 333, 300, 300, 500, 750, 750, 750, 500,
    667, 667, 667, 667, 667, 667, 944, 667, 667, 667, 667, 667, 389, 389, 389, 389,
    722, 722, 722, 722, 722, 722, 722, 570, 722, 722, 722, 722, 722, 611, 611, 500,
    500, 500, 500, 500, 500, 500, 722, 444, 444, 444, 444, 444, 278, 278, 278, 278,
    500, 556, 500, 500, 500, 500, 500, 549, 500, 556, 556, 556, 556, 444, 500, 444,
  ],
};

function table(f: Face): number[] | null {
  if (f.family === "courier") return null; // every glyph 600
  if (f.family === "helvetica") return f.bold ? W.helveticaBold : W.helvetica;
  return f.bold ? (f.italic ? W.timesBoldItalic : W.timesBold) : f.italic ? W.timesItalic : W.times;
}

/** Unicode -> WinAnsi for the characters in 0x80..0x9f (the rest of Latin-1 is itself). */
const WIN: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89, 0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };

/** Text as WinAnsi bytes; characters it lacks become "?" (other scripts need an embedded font). */
export function toWinAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xa0 && c <= 0xff) out.push(c);
    else if (WIN[c] !== undefined) out.push(WIN[c]);
    else out.push(0x3f);
  }
  return out;
}

/** The characters in `s` WinAnsi lacks (toWinAnsi writes "?" for them), each once, in order. */
export function outsideWinAnsi(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    if (out.includes(ch) || /\s/.test(ch)) continue;
    if (toWinAnsi(ch)[0] === 0x3f && ch !== "?") out.push(ch);
  }
  return out;
}

/** Width of a WinAnsi byte in 1/1000 em. */
export function glyphWidth(b: number, face: Face = HELVETICA): number {
  const t = table(face);
  if (!t) return 600;
  return b >= 0x20 && b <= 0xff ? t[b - 0x20] || t[0x3f - 0x20] : t[0x3f - 0x20];
}

/** Width of a string in points at `size`. */
export function textWidth(s: string, size: number, face: Face = HELVETICA): number {
  let w = 0;
  for (const b of toWinAnsi(s)) w += glyphWidth(b, face);
  return (w * size) / 1000;
}

/**
 * Greedy word wrap to `max` points. Newlines start a new line; a word longer than a line is
 * broken between characters.
 */
export function wrap(text: string, max: number, size: number, face: Face = HELVETICA): string[] {
  const width = (s: string) => textWidth(s, size, face);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (width(candidate) <= max || (!line && width(word) <= max)) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      let piece = "";
      for (const ch of word) {
        if (piece && width(piece + ch) > max) {
          out.push(piece);
          piece = ch;
        } else piece += ch;
      }
      line = piece;
    }
    out.push(line);
  }
  return out;
}

/** Escape text for a PDF literal string, as WinAnsi bytes. */
export function pdfString(s: string): string {
  let out = "";
  for (const b of toWinAnsi(s)) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += "\\" + b.toString(8).padStart(3, "0");
  }
  return out;
}

const STYLE = (f: Face) => (f.bold ? (f.italic ? 3 : 1) : f.italic ? 2 : 0);

/** The font's PDF name (/BaseFont). */
export function baseFont(f: Face): string {
  const s = STYLE(f);
  if (f.family === "times") return ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"][s];
  const root = f.family === "courier" ? "Courier" : "Helvetica";
  return [root, `${root}-Bold`, `${root}-Oblique`, `${root}-BoldOblique`][s];
}

/** The font's resource name in an appearance (Acrobat's own names for the standard fonts). */
export function fontResource(f: Face): string {
  const s = STYLE(f);
  if (f.family === "times") return ["TiRo", "TiBo", "TiIt", "TiBI"][s];
  if (f.family === "courier") return ["Cour", "CoBo", "CoOb", "CoBO"][s];
  return ["Helv", "HeBo", "HeOb", "HeBO"][s];
}

/** The screen font with the same widths, as a CSS family list. */
export function cssFamily(f: Family): string {
  return f === "times" ? '"Times New Roman", Times, serif' : f === "courier" ? '"Courier New", Courier, monospace' : "Arial, Helvetica, sans-serif";
}

/** A canvas font string for a face at `px`. */
export function cssFont(f: Face, px: number): string {
  return `${f.italic ? "italic " : ""}${f.bold ? "bold " : ""}${px}px ${cssFamily(f.family)}`;
}

/** The screen font's ascent and descent (em), for lining a text field up with the canvas. */
export function screenMetrics(f: Family): { ascent: number; descent: number } {
  return f === "times" ? { ascent: 0.891, descent: 0.216 } : f === "courier" ? { ascent: 0.833, descent: 0.3 } : { ascent: 0.905, descent: 0.212 };
}
