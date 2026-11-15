// Draws a markup's operations (src/lib/markup/ops.ts) on the canvas, through the viewer's page
// transform (Viewer.setPainter). The same operations become the saved appearance stream, so
// what's drawn here is what other apps show. Text is drawn in the Windows font with the same
// widths as the PDF's (fonts.ts), so lines break in the same places.

import type { Op } from "../markup/ops";
import { cssFont } from "../markup/fonts";
import type { Rgb } from "../markup/types";
// Stamps
import { paintImage } from "./stampImages";

const css = (c: Rgb, a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

/**
 * Paint operations with page points mapped by `m` (a canvas transform from page points to
 * device pixels). `hideText` leaves text out (a text box being edited shows its editor instead).
 */
export function paintOps(ctx: CanvasRenderingContext2D, ops: Op[], m: [number, number, number, number, number, number], hideText = false): void {
  for (const op of ops) {
    ctx.save();
    ctx.setTransform(...m);
    // Stamps
    if (op.t === "image") {
      paintImage(ctx, op);
      ctx.restore();
      continue;
    }

    // Text markups
    if (op.t === "path") {
      if (op.decoration && hideText) {
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      for (const s of op.segs) {
        if (s[0] === "M") ctx.moveTo(s[1], s[2]);
        else if (s[0] === "L") ctx.lineTo(s[1], s[2]);
        else if (s[0] === "C") ctx.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
        else ctx.closePath();
      }
      if (op.fill) {
        ctx.globalAlpha = op.fillOpacity;
        ctx.fillStyle = css(op.fill);
        ctx.fill();
      }
      if (op.stroke) {
        ctx.globalAlpha = op.strokeOpacity;
        ctx.strokeStyle = css(op.stroke);
        ctx.lineWidth = op.width;
        ctx.lineCap = op.decoration ? "butt" : "round";
        ctx.lineJoin = "round";
        ctx.setLineDash(op.dash ?? []);
        ctx.stroke();
      }
    } else if (!hideText) {
      if (op.clip) {
        ctx.beginPath();
        ctx.moveTo(op.clip[0][0], op.clip[0][1]);
        for (const p of op.clip.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.closePath();
        ctx.clip();
      }
      ctx.fillStyle = css(op.colour);
      ctx.font = cssFont(op.face, op.size);
      ctx.textBaseline = "alphabetic";
      const ang = Math.atan2(op.dir[1], op.dir[0]);
      op.lines.forEach((line, i) => {
        ctx.save();
        ctx.translate(op.origin[0] - op.dir[1] * i * op.leading, op.origin[1] + op.dir[0] * i * op.leading);
        if (ang) ctx.rotate(ang);
        ctx.fillText(line, op.offsets[i] ?? 0, 0);
        ctx.restore();
      });
    }
    ctx.restore();
  }
}
