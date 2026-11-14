// Helvetica metrics (the standard-14 font, so nothing is embedded) and line breaking, shared by
// the overlay and the saved appearance so a text box wraps the same in both. The widths are
// Adobe's Helvetica AFM (checked in phase 0 against reportlab's copy). On screen the text is
// drawn in Arial, which has Helvetica's widths. Pure.

const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space .. /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0..9
  278, 278, 584, 584, 584, 556, 1015, // : ; < = > ? @
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, // A..M
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // N..Z
  278, 278, 278, 469, 556, 333, // [ \ ] ^ _ `
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, // a..m
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // n..z
  334, 260, 334, 584, // { | } ~
];

const EXTRA: Record<number, number> = {
  0xb0: 400, // degree
  0xb1: 584, // plus-minus
  0xb2: 333, // superscript two
  0xb3: 333, // superscript three
  0xd7: 584, // multiply
  0x96: 556, // en dash
  0x97: 1000, // em dash
};

/** Unicode -> WinAnsi for the characters outside Latin-1 that WinAnsi has. */
const WIN: Record<number, number> = {
  0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x20ac: 0x80,
};

/** Text as WinAnsi bytes; characters it lacks become "?" (other scripts need an embedded font: later). */
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

/** Width of a WinAnsi byte in 1/1000 em. */
export function glyphWidth(b: number): number {
  if (b >= 0x20 && b <= 0x7e) return ASCII[b - 0x20];
  return EXTRA[b] ?? 556;
}

/** Width of a string in points at `size`. */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const b of toWinAnsi(s)) w += glyphWidth(b);
  return (w * size) / 1000;
}

/**
 * Greedy word wrap to `max` points. Newlines start a new line; a word longer than a line is
 * broken between characters.
 */
export function wrap(text: string, max: number, size: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size) <= max || (!line && textWidth(word, size) <= max)) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      let piece = "";
      for (const ch of word) {
        if (piece && textWidth(piece + ch, size) > max) {
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
