// Mouse, trackpad and keyboard handling. Translates DOM events into Viewer calls.
//
// CAD navigation (picked automatically from the page size, or chosen)
//   middle drag            pan 1:1          double middle click   fit page
//   wheel (notched)        zoom at cursor   wheel (touchpad)      pan
//   shift + wheel          horizontal pan   ctrl + wheel / pinch  zoom at cursor
//   space + left drag      pan
//   left drag / click      the left-button handler (text selection and links, textTool.ts)
// Document navigation
//   wheel scrolls, shift+wheel scrolls sideways, ctrl+wheel / pinch zooms.
// Keyboard (both): + / - zoom, Ctrl+0 fit page, Ctrl+1 actual size, Ctrl+2 fit width,
//   PgUp/PgDn previous/next page, Home/End first/last page,
//   F12 debug overlay.

import type { Viewer } from "./viewer";
import { blockedWhileTyping } from "./keys";
import {
  WheelClassifier,
  deltaToPixels,
  pinchZoomFactor,
  wheelZoomFactor,
} from "../view/viewMath";

export interface InputCallbacks {
  open(): void;
  toggleDebug(): void;
  /** True while a modal owns the keyboard (a dialog or the print dialog). */
  blocked?(): boolean;
  /** False with no document open: the view keys then do nothing, as their menu items are disabled. */
  hasDoc?(): boolean;
  /** The left button (without Space): text selection and links. */
  left?: LeftButton;
  /** Right-click on the canvas, at client coordinates. */
  contextMenu?(clientX: number, clientY: number): void;
}

/** Modifier keys held during a pointer event. */
export interface PointerMods {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** What the left button does on the canvas. Coordinates are CSS px in the viewport. */
export interface LeftButton {
  /** Button down; `clicks` counts quick repeats (2 double, 3 triple). True takes the gesture. */
  down(x: number, y: number, clicks: number, mods: PointerMods): boolean;
  move(x: number, y: number, mods: PointerMods): void;
  up(x: number, y: number, mods: PointerMods): void;
  leave(): void;
  /** The cursor to show, or null for the default. */
  cursor(): string | null;
}

const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_PX = 6;

export function attachInput(el: HTMLElement, viewer: Viewer, cb: InputCallbacks): () => void {
  let dragging: { id: number; x: number; y: number } | null = null;
  let spaceHeld = false;
  let lastMiddle = { t: 0, x: 0, y: 0 };
  let lastLeft = { t: 0, x: 0, y: 0, clicks: 0 };
  /** The pointer holding the left button for cb.left, if any. */
  let leftId: number | null = null;
  const wheel = new WheelClassifier();

  const mods = (e: MouseEvent): PointerMods => ({ shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });

  const local = (e: MouseEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const setCursor = () => {
    el.style.cursor = dragging ? "grabbing" : spaceHeld ? "grab" : (cb.left?.cursor() ?? "default");
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault(); // also stops WebView2's own ctrl+wheel page zoom
    const [x, y] = local(e);
    const kind = wheel.classify(e.deltaX, e.deltaY, e.deltaMode, e.timeStamp);
    const notched = kind === "notch";
    viewer.lastWheel = `dx=${e.deltaX} dy=${e.deltaY} mode=${e.deltaMode}${e.ctrlKey ? " ctrl" : ""}${e.shiftKey ? " shift" : ""} -> ${kind}`;

    if (e.ctrlKey) {
      // Ctrl+wheel, or a touchpad pinch (Chromium sends pinch as ctrl+wheel).
      if (notched) viewer.zoomAt(x, y, wheelZoomFactor(e.deltaY, e.deltaMode), true);
      else viewer.zoomAt(x, y, pinchZoomFactor(deltaToPixels(e.deltaY, e.deltaMode)), false);
      return;
    }
    const dx = deltaToPixels(e.deltaX, e.deltaMode);
    const dy = deltaToPixels(e.deltaY, e.deltaMode);
    if (e.shiftKey) {
      // Some mice/drivers already swap the axis when shift is held.
      viewer.panBy(-(dx || dy), 0);
      return;
    }
    if (viewer.navMode === "cad" && notched) {
      viewer.zoomAt(x, y, wheelZoomFactor(e.deltaY, e.deltaMode), true);
      return;
    }
    viewer.scrollBy(-dx, -dy);
  };

  const onPointerDown = (e: PointerEvent) => {
    const middle = e.button === 1;
    const spaceLeft = e.button === 0 && spaceHeld;
    // Something floating over the drawing (the properties strip, a text box being typed in) takes
    // its own presses: only presses on the canvas itself are the drawing's.
    if (e.button === 0 && e.target !== el && !(e.target instanceof HTMLCanvasElement)) return;
    if (e.button === 0 && !spaceHeld && cb.left && (cb.hasDoc?.() ?? true)) {
      const now = performance.now();
      const again = now - lastLeft.t < DOUBLE_CLICK_MS && Math.hypot(e.clientX - lastLeft.x, e.clientY - lastLeft.y) < DOUBLE_CLICK_PX;
      const clicks = again ? (lastLeft.clicks % 3) + 1 : 1;
      lastLeft = { t: now, x: e.clientX, y: e.clientY, clicks };
      const [x, y] = local(e);
      if (cb.left.down(x, y, clicks, mods(e))) {
        e.preventDefault();
        leftId = e.pointerId;
        el.setPointerCapture(e.pointerId);
      }
      setCursor();
      return;
    }
    if (!middle && !spaceLeft) return;
    e.preventDefault(); // no Windows autoscroll on middle click
    if (middle) {
      const now = performance.now();
      if (
        now - lastMiddle.t < DOUBLE_CLICK_MS &&
        Math.hypot(e.clientX - lastMiddle.x, e.clientY - lastMiddle.y) < DOUBLE_CLICK_PX
      ) {
        lastMiddle.t = 0;
        viewer.fit("page", false, true);
        return;
      }
      lastMiddle = { t: now, x: e.clientX, y: e.clientY };
    }
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
    setCursor();
  };

  const onPointerMove = (e: PointerEvent) => {
    // Cursor position for the status bar (page coordinates are worked out by the viewer).
    if (e.pointerType !== "touch") {
      const [x, y] = local(e);
      viewer.setPointer(x, y);
      if (!dragging) {
        cb.left?.move(x, y, mods(e));
        setCursor();
      }
    }
    if (!dragging || e.pointerId !== dragging.id) return;
    const dx = e.clientX - dragging.x;
    const dy = e.clientY - dragging.y;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    if (dx || dy) viewer.dragPan(dx, dy);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (leftId !== null && e.pointerId === leftId) {
      leftId = null;
      const [x, y] = local(e);
      cb.left?.up(x, y, mods(e));
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      setCursor();
      return;
    }
    if (!dragging || e.pointerId !== dragging.id) return;
    dragging = null;
    viewer.endDrag();
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    setCursor();
  };

  const onPointerLeave = () => {
    if (!dragging && leftId === null) {
      viewer.setPointer(null);
      cb.left?.leave();
    }
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault(); // no WebView menu (Back, Reload, Inspect) over the drawing
    cb.contextMenu?.(e.clientX, e.clientY);
  };

  // Middle mousedown must be cancelled separately or Chromium starts autoscroll.
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  const onAuxClick = (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (cb.blocked?.() || blockedWhileTyping(e)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const doc = cb.hasDoc?.() ?? true;
    let handled = true;
    if (e.key === " ") {
      if (!spaceHeld) {
        spaceHeld = true;
        setCursor();
      }
    } else if (e.key === "F12" || (ctrl && e.shiftKey && e.key.toLowerCase() === "d")) {
      if (!e.repeat) cb.toggleDebug();
    } else if (ctrl && e.key.toLowerCase() === "o") {
      if (!e.repeat) cb.open();
    } else if (!doc) {
      handled = false;
    } else if (ctrl && !e.shiftKey && e.key === "0") {
      viewer.fit("page", false, true);
    } else if (ctrl && !e.shiftKey && e.key === "1") {
      viewer.actualSize(true);
    } else if (ctrl && !e.shiftKey && e.key === "2") {
      viewer.fit("width", false, true);
    } else if (e.key === "+" || e.key === "=" || e.key === "Add") {
      viewer.zoomStep(1);
    } else if (e.key === "-" || e.key === "_" || e.key === "Subtract") {
      viewer.zoomStep(-1);
    } else if (e.key === "PageDown") {
      viewer.nextPage();
    } else if (e.key === "PageUp") {
      viewer.prevPage();
    } else if (e.key === "Home") {
      viewer.firstPage();
    } else if (e.key === "End") {
      viewer.lastPage();
    } else {
      handled = false;
    }
    if (handled) e.preventDefault();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") {
      spaceHeld = false;
      setCursor();
    }
  };

  const onBlur = () => {
    spaceHeld = false;
    if (leftId !== null) cb.left?.up(-1, -1, { shift: false, ctrl: false, alt: false });
    leftId = null;
    dragging = null;
    viewer.endDrag();
    setCursor();
  };

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("pointerleave", onPointerLeave);
  el.addEventListener("mousedown", onMouseDown);
  el.addEventListener("auxclick", onAuxClick);
  el.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("pointerleave", onPointerLeave);
    el.removeEventListener("mousedown", onMouseDown);
    el.removeEventListener("auxclick", onAuxClick);
    el.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}
