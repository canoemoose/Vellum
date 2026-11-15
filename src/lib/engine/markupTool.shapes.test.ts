// Stage 6 (docs/editing-tool-consistency-brief.md): shapes. Tested against the gesture, not the
// kind: every tool that clicks out a shape of points with no fixed count gets the bounding box
// and adding and removing corners; every tool whose drag is "regular" drags a regular polygon
// with Sides.

import { beforeEach, describe, expect, it } from "vitest";
import { installFakes, openViewer } from "./testkit";
import { MarkupTool, type Mods } from "./markupTool";
import { MarkupDoc } from "./markupDoc";
import { type Markup, type Pt, defaultStyle, DEFAULT_TEXT } from "../markup/types";
import { kindOf } from "../markup/kinds";
import { type KindDef, pointLock } from "../markup/kinds/kind";
import { isBoxGrip } from "../markup/shape";
import { type ToolDef, TOOLS, gestureTip, toolById } from "../markup/tools";
import { handles, shapeBounds } from "../markup/geometry";
import { barFor, subjectOf, subjectOfTool } from "../markup/bar";
import { matchesRegular, regularVertices, type Regular } from "../markup/regular";
import type { Viewer } from "./viewer";

beforeEach(installFakes);

const none: Mods = { shift: false, ctrl: false, alt: false };
const shift: Mods = { ...none, shift: true };

async function setup(sides?: number) {
  const { v } = await openViewer([{ w: 600, h: 400 }]);
  v.setZoom(1);
  v.centreOn(0, 300, 200);
  const doc = new MarkupDoc();
  const t = new MarkupTool(v, {
    styleFor: (k) => defaultStyle(k),
    textStyle: () => DEFAULT_TEXT,
    author: () => "Tester",
    onChange: () => {},
    sides: sides === undefined ? undefined : () => sides,
  });
  t.attach(doc);
  return { v, doc, t };
}

const scr = (v: Viewer, x: number, y: number): [number, number] => v.pageToScreen(0, x, y)!;

function drag(t: MarkupTool, v: Viewer, a: Pt, b: Pt, mods = none) {
  const [sx, sy] = scr(v, a[0], a[1]);
  const [ex, ey] = scr(v, b[0], b[1]);
  t.down(sx, sy, 1, mods);
  for (let k = 1; k <= 4; k++) t.move(sx + ((ex - sx) * k) / 4, sy + ((ey - sy) * k) / 4, mods);
  t.up(ex, ey, mods);
}

function click(t: MarkupTool, v: Viewer, a: Pt, clicks = 1, mods = none) {
  const [sx, sy] = scr(v, a[0], a[1]);
  t.down(sx, sy, clicks, mods);
  t.up(sx, sy, mods);
}

const def = (t: ToolDef) => kindOf(t.kind!) as unknown as KindDef;
const drawing = TOOLS.filter((t) => t.kind && t.group !== "stamp");
/** Tools that click out a shape with no fixed number of points. */
const shapesOfPoints = drawing.filter((t) => {
  const d = def(t).draw;
  return d.gesture === "points" && !d.max;
});
/** Tools whose drag makes a regular polygon. */
const regularTools = drawing.filter((t) => {
  const d = def(t).draw;
  return d.gesture === "points" && d.drag === "regular";
});

const vertsOf = (m: Markup) => (m as unknown as { vertices: Pt[] }).vertices;
/** Points equal to within float error. */
function near(got: Pt[], want: Pt[]) {
  expect(got.length).toBe(want.length);
  got.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(want[i][0], 6);
    expect(p[1]).toBeCloseTo(want[i][1], 6);
  });
}
const regularOf = (m: Markup) => (m as unknown as { regular?: Regular }).regular;

/** Click out a shape and select it in Select. */
async function drawn(tool: ToolDef, pts: Pt[]) {
  const s = await setup();
  s.t.setTool(tool.id);
  // Exactly these points: where a kind starts ortho-locked (dimensions, stage 5), Shift frees each.
  const d = def(tool).draw;
  pts.forEach((p, i) => click(s.t, s.v, p, 1, i > 0 && d.gesture === "points" && pointLock(d.lock, i).lock === "ortho" ? shift : none));
  s.t.finishPoints(true);
  s.t.setTool("select");
  s.t.select([s.doc.markups[0].id]);
  return s;
}

const SHAPE: Pt[] = [[100, 100], [200, 120], [150, 200]];

describe("stage 6: shapes of points resize by a box and by their corners [A11]", () => {
  it("covers polygon, cloud, polyline, area and polyline length", () => {
    expect(shapesOfPoints.map((t) => t.id).sort()).toEqual(["cloud", "measureArea", "measurePath", "polygon", "polyline"]);
  });

  for (const tool of shapesOfPoints) {
    it(`${tool.label}: round grips on its corners, eight square ones on its box`, async () => {
      const { doc } = await drawn(tool, SHAPE);
      const hs = handles(doc.markups[0]);
      near(hs.filter((h) => h.round).map((h) => h.at), SHAPE);
      // The box's eight (a measurement's value grip, stage 5, is besides these).
      expect(hs.filter((h) => !h.round && isBoxGrip(h.id)).length).toBe(8);
    });

    it(`${tool.label}: Shift keeps proportions when its box is resized`, async () => {
      const { v, doc, t } = await drawn(tool, SHAPE);
      drag(t, v, [200, 200], [300, 260], shift); // the box's south-east grip
      const b = shapeBounds(doc.markups[0]);
      expect(b[2] - b[0]).toBeCloseTo(b[3] - b[1], 6);
      expect(b[2] - b[0]).toBeGreaterThan(100);
    });

    it(`${tool.label}: a double-click on an edge adds a corner there, one undo step`, async () => {
      const { v, doc, t } = await drawn(tool, SHAPE);
      click(t, v, [150, 110]);
      click(t, v, [150, 110], 2);
      const after = vertsOf(doc.markups[0]);
      expect(after.length).toBe(4);
      expect(after[1][0]).toBeCloseTo(150);
      expect(after[1][1]).toBeCloseTo(110);
      t.undo();
      expect(vertsOf(doc.markups[0]).length).toBe(3);
    });

    it(`${tool.label}: the right-click menu's corner is removed, one undo step, never below the fewest`, async () => {
      const { v, doc, t } = await drawn(tool, [...SHAPE, [90, 180]]);
      // A box grip (the east one, halfway down the right side) isn't a corner.
      expect(t.cornerAt(...scr(v, 200, 150))).toBeNull();
      const c = t.cornerAt(...scr(v, 200, 120))!;
      expect(c).toMatchObject({ id: doc.markups[0].id, index: 1, removable: true });
      expect(t.removeCorner(c.id, c.index)).toBe(true);
      near(vertsOf(doc.markups[0]), [SHAPE[0], SHAPE[2], [90, 180]]);
      t.undo();
      expect(vertsOf(doc.markups[0]).length).toBe(4);
      // Down to the fewest its gesture takes: no further.
      const min = (def(tool).draw as { min: number }).min;
      while (vertsOf(doc.markups[0]).length > min) t.removeCorner(c.id, 0);
      const last = t.cornerAt(...scr(v, ...vertsOf(doc.markups[0])[0]))!;
      expect(last.removable).toBe(false);
      expect(t.removeCorner(c.id, 0)).toBe(false);
    });
  }

  it("leaves the kinds with a fixed number of points alone", async () => {
    const { v, doc, t } = await setup();
    t.setTool("arrow");
    drag(t, v, [100, 100], [200, 150]);
    t.setTool("select");
    t.select([doc.markups[0].id]);
    click(t, v, [150, 125]);
    click(t, v, [150, 125], 2);
    const a = doc.markups[0] as unknown as { from: Pt; to: Pt };
    near([a.from, a.to], [[100, 100], [200, 150]]);
    expect(Object.keys(a)).not.toContain("vertices");
    expect(t.cornerAt(...scr(v, 100, 100))).toBeNull();
  });
});

describe("stage 6: a regular polygon dragged from the centre, with Sides [D11]", () => {
  it("is Polygon's drag (Cloud and Area keep dragging a box)", () => {
    expect(regularTools.map((t) => t.id)).toEqual(["polygon"]);
    expect((def(toolById("cloud")!).draw as { drag: string }).drag).toBe("box");
    expect((def(toolById("measureArea")!).draw as { drag: string }).drag).toBe("box");
  });

  it("tooltips: Rectangle drags corner to corner, Polygon from the centre", () => {
    expect(gestureTip(def(toolById("rect")!))).toContain("drag corner to corner");
    for (const tool of regularTools) expect(gestureTip(def(tool))).toContain("drag from the centre");
  });

  for (const tool of regularTools) {
    it(`${tool.label}: takes the tool's Sides, and a drag under 4 px starts clicking one out`, async () => {
      const { v, doc, t } = await setup(8);
      t.setTool(tool.id);
      drag(t, v, [300, 200], [340, 230]);
      const m = doc.markups[0];
      expect(vertsOf(m).length).toBe(8);
      expect(matchesRegular(regularOf(m)!, vertsOf(m))).toBe(true);
      drag(t, v, [100, 100], [102, 101]);
      expect(t.drawingPoints).toBe(true);
      t.finishPoints(false);
      expect(doc.markups.length).toBe(1);
      // Clicked out, it is freeform.
      for (const p of SHAPE) click(t, v, p);
      t.finishPoints(true);
      expect(regularOf(doc.markups[1])).toBeUndefined();
      expect(barFor([subjectOf(doc.markups[1])])!.sides).toBe(false);
    });

    for (const quarter of [0, 1, 2, 3]) {
      it(`${tool.label}: Shift puts a flat side at the bottom as viewed, view turned ${quarter * 90} degrees`, async () => {
        const { v, doc, t } = await setup(5);
        v.setRotation(quarter * 90);
        v.centreOn(0, 300, 200);
        t.setTool(tool.id);
        drag(t, v, [300, 200], [330, 215], shift);
        const ys = vertsOf(doc.markups[0]).map((p) => scr(v, p[0], p[1])[1]);
        const low = Math.max(...ys);
        expect(ys.filter((y) => Math.abs(y - low) < 1e-6).length).toBe(2);
      });
    }

    it(`${tool.label}: Sides changes it (same centre, size and turn), one undo step, until a corner is dragged`, async () => {
      const { v, doc, t } = await setup();
      t.setTool(tool.id);
      drag(t, v, [300, 200], [360, 200]);
      const before = regularOf(doc.markups[0])!;
      expect(before.sides).toBe(6);
      // With the tool out the bar shows Sides and changes what was just drawn.
      expect(barFor([subjectOfTool(tool)])!.sides).toBe(true);
      expect(t.selectedSides()).toBe(6);
      expect(t.setSides(4)).toBe(true);
      const after = regularOf(doc.markups[0])!;
      expect(after).toEqual({ ...before, sides: 4 });
      expect(vertsOf(doc.markups[0])).toEqual(regularVertices(after));
      t.undo();
      expect(vertsOf(doc.markups[0]).length).toBe(6);
      // A corner dragged: freeform, and Sides goes from the bar.
      t.setTool("select");
      t.select([doc.markups[0].id]);
      drag(t, v, [360, 200], [380, 190]);
      const m = doc.markups[0];
      expect(regularOf(m)).toBeUndefined();
      near([vertsOf(m)[0]], [[380, 190]]);
      expect(barFor([subjectOf(m)])!.sides).toBe(false);
      expect(t.selectedSides()).toBeNull();
      expect(t.setSides(5)).toBe(false);
    });

    it(`${tool.label}: moving it or resizing it in proportion keeps it regular; stretching it, or adding a corner, makes it freeform`, async () => {
      const { v, doc, t } = await setup();
      t.setTool(tool.id);
      drag(t, v, [300, 200], [300, 260], shift);
      t.setTool("select");
      const id = doc.markups[0].id;
      t.select([id]);
      t.nudge(10, 0);
      expect(regularOf(doc.markups[0])!.centre[0]).toBeGreaterThan(305);
      expect(t.selectedSides()).toBe(6);
      let b = shapeBounds(doc.markups[0]);
      drag(t, v, [b[2], b[3]], [b[2] + 40, b[3] + 40], shift);
      expect(t.selectedSides()).toBe(6);
      expect(matchesRegular(regularOf(doc.markups[0])!, vertsOf(doc.markups[0]))).toBe(true);
      // Stretched by its south grip (its east one sits on a corner, which would win).
      b = shapeBounds(doc.markups[0]);
      drag(t, v, [(b[0] + b[2]) / 2, b[3]], [(b[0] + b[2]) / 2, b[3] + 30]);
      expect(shapeBounds(doc.markups[0])[3]).toBeCloseTo(b[3] + 30);
      expect(regularOf(doc.markups[0])).toBeUndefined();
      t.undo();
      expect(t.selectedSides()).toBe(6);
      // A corner added on an edge (one clear of the box's grips).
      const vs = vertsOf(doc.markups[0]);
      const mid: Pt = [(vs[1][0] + vs[2][0]) / 2, (vs[1][1] + vs[2][1]) / 2];
      click(t, v, mid);
      click(t, v, mid, 2);
      expect(vertsOf(doc.markups[0]).length).toBe(7);
      expect(regularOf(doc.markups[0])).toBeUndefined();
    });
  }
});
