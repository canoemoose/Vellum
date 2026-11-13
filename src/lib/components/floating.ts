// A Svelte action that makes a dialog movable and resizable inside the app window: drag its
// header to move it, drag an edge or corner to resize, double-click the header to put it back
// to its default size, centred. Its box is remembered under its key; dialogs that share a key
// share one box (Print and Manual layout behave as two pages of one window). The maths is in
// shell/floatBox.ts; this only wires pointers and styles.

import {
  type Edge, type FloatBox, type Limits, centred, clampBox, moved, parseBox, resized,
} from "../shell/floatBox";

export interface FloatingOptions {
  /** Remembered under this name. */
  key: string;
  /** Default size, CSS px (centred). */
  w: number;
  h: number;
  minW: number;
  minH: number;
}

const MARGIN = 12;
const GRIP = 6; // px of edge that resizes
const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const CURSOR: Record<Edge, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

const storeKey = (k: string) => `vellum.dialogBox.${k}`;

function load(k: string): FloatBox | null {
  try {
    const raw = localStorage.getItem(storeKey(k));
    return raw ? parseBox(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function save(k: string, b: FloatBox) {
  try {
    localStorage.setItem(storeKey(k), JSON.stringify(b));
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** Controls in the header keep their own clicks. */
const isControl = (t: EventTarget | null) => t instanceof Element && !!t.closest("button, input, select, textarea, a, [role=button]");

function grip(edge: Edge): HTMLDivElement {
  const d = document.createElement("div");
  d.dataset.edge = edge;
  const s = d.style;
  s.position = "absolute";
  s.zIndex = "5";
  s.cursor = CURSOR[edge];
  const long = edge.length === 1;
  // Just inside the edge: the dialog clips anything outside it (rounded corners).
  if (edge.includes("n")) s.top = "0";
  if (edge.includes("s")) s.bottom = "0";
  if (edge.includes("w")) s.left = "0";
  if (edge.includes("e")) s.right = "0";
  if (long && (edge === "n" || edge === "s")) {
    s.left = `${GRIP}px`;
    s.right = `${GRIP}px`;
    s.height = `${GRIP}px`;
  } else if (long) {
    s.top = `${GRIP}px`;
    s.bottom = `${GRIP}px`;
    s.width = `${GRIP}px`;
  } else {
    s.width = `${GRIP * 2}px`;
    s.height = `${GRIP * 2}px`;
  }
  return d;
}

export function floating(node: HTMLElement, opts: FloatingOptions) {
  const limits = (): Limits => ({ vw: window.innerWidth, vh: window.innerHeight, minW: opts.minW, minH: opts.minH, margin: MARGIN });
  let box = clampBox(load(opts.key) ?? centred(opts.w, opts.h, limits()), limits());

  const apply = () => {
    const s = node.style;
    s.position = "fixed";
    s.left = `${box.x}px`;
    s.top = `${box.y}px`;
    s.width = `${box.w}px`;
    s.height = `${box.h}px`;
    s.maxWidth = "none";
    s.maxHeight = "none";
    s.margin = "0";
  };
  apply();

  // The grips sit in a frame laid over the whole dialog, which lets everything else through.
  const frame = document.createElement("div");
  frame.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:5";
  for (const e of EDGES) {
    const g = grip(e);
    g.style.pointerEvents = "auto";
    frame.appendChild(g);
  }
  node.appendChild(frame);

  let drag: { pointer: number; x: number; y: number; start: FloatBox; edge: Edge | null } | null = null;
  /** When the header (not a control or an edge) was last pressed; 0 for not just now. */
  let headerDownAt = 0;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    headerDownAt = 0;
    const t = e.target as HTMLElement;
    const edge = (t.dataset?.edge as Edge | undefined) ?? null;
    const header = node.querySelector(":scope > header");
    if (!edge && !(header && header.contains(t) && !isControl(t))) return;
    e.preventDefault();
    drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY, start: box, edge };
    headerDownAt = edge ? 0 : e.timeStamp;
    node.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    box = drag.edge ? resized(drag.start, drag.edge, dx, dy, limits()) : moved(drag.start, dx, dy, limits());
    apply();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
    save(opts.key, box);
  };
  const onDbl = (e: MouseEvent) => {
    // The header drag captures the pointer, so the double-click arrives on the dialog itself,
    // not the header: go by where the last press was instead.
    if (!headerDownAt || e.timeStamp - headerDownAt > 1000) return;
    headerDownAt = 0;
    box = centred(opts.w, opts.h, limits());
    apply();
    save(opts.key, box);
  };
  const onResize = () => {
    box = clampBox(box, limits());
    apply();
  };

  node.addEventListener("pointerdown", onDown);
  node.addEventListener("pointermove", onMove);
  node.addEventListener("pointerup", onUp);
  node.addEventListener("pointercancel", onUp);
  node.addEventListener("dblclick", onDbl);
  window.addEventListener("resize", onResize);

  return {
    destroy() {
      node.removeEventListener("pointerdown", onDown);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      node.removeEventListener("dblclick", onDbl);
      window.removeEventListener("resize", onResize);
      frame.remove();
    },
  };
}

/**
 * The Print dialog and its Manual layout page: one box, so going between them keeps the
 * dialog where it is and the size it is. Sized for the manual layout, the roomier of the two.
 */
export const PRINT_BOX: FloatingOptions = { key: "print", w: 1240, h: 800, minW: 900, minH: 560 };
