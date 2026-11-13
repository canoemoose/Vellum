import { describe, expect, it } from "vitest";
import { type Box, type TextLayer, type TextLink, parseTextLayer, textOf, EMPTY_LAYER } from "./layer";
import { CharIndex, lineDirection, lineRange, rangeRects, sameLine, wordRange } from "./hit";
import { isEmpty, joinPages, ordered, rangeOnPage, selectedPages } from "./selection";
import { followableUrl, linkAt, linkLabel } from "./links";
import { HitList, countLabel, searchOrder, stepHit } from "./searchModel";

/**
 * A layer of lines of text, as PDFium would report it: one box per character, 6 pt wide and
 * 10 pt tall, with a generated "\r\n" between lines. `vertical` lines run down the page.
 */
function layerOf(lines: { text: string; x: number; y: number; vertical?: boolean }[], links: TextLink[] = []): TextLayer {
  const codes: number[] = [];
  const boxes: number[] = [];
  const flags: number[] = [];
  lines.forEach((ln, li) => {
    if (li > 0)
      for (const c of "\r\n") {
        codes.push(c.charCodeAt(0));
        boxes.push(0, 0, 0, 0);
        flags.push(1);
      }
    [...ln.text].forEach((ch, k) => {
      codes.push(ch.codePointAt(0)!);
      if (ln.vertical) boxes.push(ln.x, ln.y + k * 6, ln.x + 10, ln.y + k * 6 + 6);
      else boxes.push(ln.x + k * 6, ln.y, ln.x + k * 6 + 6, ln.y + 10);
      flags.push(ch === " " ? 2 : 2);
    });
  });
  return { n: codes.length, codes: Uint32Array.from(codes), boxes: Float32Array.from(boxes), flags: Uint8Array.from(flags), links };
}

/** Encode a layer the way text.rs does, to test the parser. */
function encode(l: TextLayer): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(l.links));
  const head = 4 + 4 * l.n + 16 * l.n + l.n;
  const pad = Math.ceil(head / 4) * 4;
  const buf = new ArrayBuffer(pad + 4 + json.length + 3); // trailing bytes: the parser must not care
  const dv = new DataView(buf);
  dv.setUint32(0, l.n, true);
  for (let i = 0; i < l.n; i++) dv.setUint32(4 + 4 * i, l.codes[i], true);
  for (let i = 0; i < l.n * 4; i++) dv.setFloat32(4 + 4 * l.n + 4 * i, l.boxes[i], true);
  new Uint8Array(buf, 4 + 20 * l.n, l.n).set(l.flags);
  dv.setUint32(pad, json.length, true);
  new Uint8Array(buf, pad + 4, json.length).set(json);
  return buf;
}

const doc = () =>
  layerOf([
    { text: "Stage left", x: 100, y: 100 },
    { text: "Rigging point 12", x: 100, y: 120 },
  ]);

describe("text layer", () => {
  it("parses what the backend sends", () => {
    const link: TextLink = { rects: [[1, 2, 3, 4]], uri: "https://example.com", page: null, y: null };
    const l = layerOf([{ text: "Hé 𝔸", x: 0, y: 0 }], [link]);
    const p = parseTextLayer(encode(l));
    expect(p.n).toBe(l.n);
    expect(Array.from(p.codes)).toEqual(Array.from(l.codes));
    expect(Array.from(p.boxes)).toEqual(Array.from(l.boxes));
    expect(Array.from(p.flags)).toEqual(Array.from(l.flags));
    expect(p.links).toEqual([link]);
    expect(textOf(p, 0, p.n)).toBe("Hé 𝔸");
  });

  it("parses an empty layer", () => {
    const p = parseTextLayer(encode(EMPTY_LAYER));
    expect(p.n).toBe(0);
    expect(p.links).toEqual([]);
  });

  it("turns inferred line breaks into newlines and drops control characters", () => {
    const l = doc();
    expect(textOf(l, 0, l.n)).toBe("Stage left\nRigging point 12");
    const odd = layerOf([{ text: "co\u0002op", x: 0, y: 0 }]);
    expect(textOf(odd, 0, odd.n)).toBe("coop");
  });
});

describe("hit testing", () => {
  it("finds the character under the pointer and nothing far away", () => {
    const l = doc();
    const idx = new CharIndex(l);
    expect(idx.nearest(103, 105, 0)).toBe(0); // inside "S"
    expect(idx.nearest(115, 125, 0)).toBe(14); // "g" of Rigging: 10 chars + \r\n + 2
    expect(idx.nearest(500, 500, 4)).toBeNull();
    expect(idx.nearest(98, 105, 4)).toBe(0); // just left of the line
  });

  it("puts the caret before or after a character by which half the pointer is in", () => {
    const idx = new CharIndex(doc());
    expect(idx.caret(101, 105)).toBe(0);
    expect(idx.caret(105, 105)).toBe(1);
    expect(idx.caret(1000, 105, 100)).toBeNull();
    // Past the end of a line, further away: still finds the line's last character.
    expect(idx.caret(170, 105)).toBe(10);
  });

  it("follows vertical text", () => {
    const l = layerOf([{ text: "UP", x: 50, y: 50, vertical: true }]);
    expect(lineDirection(l, 0)).toEqual([0, 1]);
    const idx = new CharIndex(l);
    expect(idx.caret(55, 51)).toBe(0);
    expect(idx.caret(55, 55)).toBe(1);
    expect(rangeRects(l, 0, 2)).toEqual([[50, 50, 60, 62]]);
  });

  it("selects words and lines", () => {
    const l = doc();
    expect(wordRange(l, 2)).toEqual([0, 5]); // "Stage"
    expect(wordRange(l, 5)).toEqual([5, 6]); // the space alone
    expect(textOf(l, ...wordRange(l, 26))).toBe("12");
    expect(lineRange(l, 3)).toEqual([0, 10]);
    expect(textOf(l, ...lineRange(l, 15))).toBe("Rigging point 12");
  });

  it("merges a run of characters into one rectangle per line", () => {
    const l = doc();
    const rects = rangeRects(l, 6, 19); // "left" + break + "Rigging"
    expect(rects).toEqual([
      [136, 100, 160, 110],
      [100, 120, 142, 130],
    ] satisfies Box[]);
    expect(rangeRects(l, 3, 3)).toEqual([]);
  });

  it("tells lines apart", () => {
    expect(sameLine([0, 0, 6, 10], [6, 0, 12, 10])).toBe(true);
    expect(sameLine([0, 0, 6, 10], [0, 20, 6, 30])).toBe(false);
    expect(sameLine([0, 0, 6, 10], [60, 0, 66, 10])).toBe(false); // far along the line
  });
});

describe("selection", () => {
  const sel = { anchor: { page: 3, index: 5 }, focus: { page: 1, index: 2 } };

  it("orders its ends and lists its pages", () => {
    expect(ordered(sel)).toEqual([sel.focus, sel.anchor]);
    expect(selectedPages(sel)).toEqual([1, 2, 3]);
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty({ anchor: { page: 1, index: 4 }, focus: { page: 1, index: 4 } })).toBe(true);
  });

  it("gives the range on each page", () => {
    expect(rangeOnPage(sel, 1, 40)).toEqual([2, 40]);
    expect(rangeOnPage(sel, 2, 30)).toEqual([0, 30]);
    expect(rangeOnPage(sel, 3, 40)).toEqual([0, 5]);
    expect(rangeOnPage(sel, 4, 40)).toBeNull();
    expect(rangeOnPage({ anchor: { page: 0, index: 7 }, focus: { page: 0, index: 2 } }, 0, 4)).toEqual([2, 4]);
  });

  it("joins pages with a blank line, dropping empty ones", () => {
    expect(joinPages(["end of one  \n", "", "start of three"])).toBe("end of one\n\nstart of three");
  });
});

describe("links", () => {
  const web: TextLink = { rects: [[10, 10, 50, 20]], uri: "https://example.com/a", page: null, y: null };
  const jump: TextLink = { rects: [[10, 30, 50, 40]], uri: null, page: 4, y: 100 };

  it("finds the link under the pointer", () => {
    expect(linkAt([web, jump], 20, 15)).toBe(web);
    expect(linkAt([web, jump], 20, 35)).toBe(jump);
    expect(linkAt([web, jump], 20, 25)).toBeNull();
    expect(linkAt([web, jump], 20, 22, 3)).toBe(web);
  });

  it("follows only web and mail addresses", () => {
    expect(followableUrl("https://example.com")).toBe("https://example.com");
    expect(followableUrl("mailto:crew@example.com")).toBe("mailto:crew@example.com");
    for (const bad of ["file:///C:/x.exe", "javascript:alert(1)", "https://", "http://a b", null, ""]) expect(followableUrl(bad)).toBeNull();
  });

  it("labels links for the status bar", () => {
    expect(linkLabel(web, 10)).toBe("Open https://example.com/a");
    expect(linkLabel(jump, 10)).toBe("Go to page 5");
    expect(linkLabel({ ...web, uri: "mailto:a@b.c" }, 10)).toBe("Email a@b.c");
    expect(linkLabel({ ...web, uri: "file:///x" }, 10)).toBe("Link not followed: file:///x");
  });
});

describe("search results", () => {
  const hit = (index: number) => ({ index, count: 3, rects: [], before: "", text: "abc", after: "" });

  it("searches from the current page round to the one before it", () => {
    expect(searchOrder(5, 3)).toEqual([3, 4, 0, 1, 2]);
    expect(searchOrder(1, 0)).toEqual([0]);
  });

  it("keeps hits in document order as pages arrive out of order", () => {
    const h = new HitList();
    h.add(3, { chars: 10, hits: [hit(1), hit(5)], truncated: false });
    h.add(0, { chars: 0, hits: [], truncated: false });
    h.add(1, { chars: 10, hits: [hit(2)], truncated: false });
    h.add(4, { chars: 10, hits: [hit(0)], truncated: false });
    expect(h.hits.map((x) => [x.page, x.index])).toEqual([[1, 2], [3, 1], [3, 5], [4, 0]]);
    expect(h.scanned).toBe(4);
    expect(h.withText).toBe(3);
    expect(h.firstFrom(2)).toBe(1);
    expect(h.firstFrom(9)).toBe(0);
    expect(h.onPage(3).length).toBe(2);
    expect(h.indexOf(h.hits[2])).toBe(2);
  });

  it("stops at its limit and says so", () => {
    const h = new HitList(3);
    h.add(0, { chars: 9, hits: [hit(0), hit(1)], truncated: false });
    expect(h.add(1, { chars: 9, hits: [hit(0), hit(1)], truncated: false })).toBe(1);
    expect(h.full).toBe(true);
    expect(h.truncated).toBe(true);
  });

  it("steps through hits, wrapping", () => {
    expect(stepHit(3, -1, 1)).toBe(0);
    expect(stepHit(3, -1, -1)).toBe(2);
    expect(stepHit(3, 2, 1)).toBe(0);
    expect(stepHit(3, 0, -1)).toBe(2);
    expect(stepHit(0, 0, 1)).toBe(-1);
  });

  it("labels the count", () => {
    expect(countLabel(2, 27, false, false)).toBe("3 of 27");
    expect(countLabel(-1, 27, true, false)).toBe("27 found…");
    expect(countLabel(-1, 0, false, false)).toBe("No results");
    expect(countLabel(-1, 0, true, false)).toBe("Searching…");
    expect(countLabel(0, 5000, false, true)).toBe("1 of 5000+");
  });
});
