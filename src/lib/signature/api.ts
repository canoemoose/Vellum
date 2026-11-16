// The signature commands (src-tauri/src/signature) and the browser-side PNG export of a
// drawing. Components call these; nothing here is Svelte.

import { invoke } from "@tauri-apps/api/core";
import { parseError, userMessage } from "../shell/messages";
import { toCommand, type Adjust } from "./frame";
import { recolour, type Rgb } from "./ink";
import { drawStrokes, exportPlan, INK, serialise, type Stroke } from "./strokes";

export type SignatureKind = "drawn" | "imported";

export interface SignatureMeta {
  id: string;
  name: string;
  kind: SignatureKind;
  width: number;
  height: number;
  createdMs: number;
}

export interface SignatureItem extends SignatureMeta {
  /** Preview PNG bytes (at most 240 x 80). */
  thumb: number[];
}

export interface SignatureListing {
  items: SignatureItem[];
  /** Files that couldn't be read (damaged, or saved by another Windows account). */
  unreadable: string[];
}

/** Image types the importer reads. HEIC and HEIF go through Windows' own codecs. */
export const IMPORT_EXTENSIONS = ["jpg", "jpeg", "heic", "heif", "png", "webp", "tif", "tiff", "bmp", "gif"];

/** The picture upright, as a JPEG at most 2048 px, to choose the framing on. */
export async function previewSignature(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("signature_preview", { path }));
}

/** Knock the paper out of a photo or scan, framed as chosen: PNG bytes with transparency. */
export async function importSignature(path: string, adjust?: Adjust): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("signature_import", { path, adjust: adjust ? toCommand(adjust) : null }));
}

export const listSignatures = () => invoke<SignatureListing>("signature_list");

export function addSignature(name: string, kind: SignatureKind, png: Uint8Array, strokes?: string) {
  return invoke<SignatureItem>("signature_add", { name, kind, png: Array.from(png), strokes: strokes ?? null });
}

export const renameSignature = (id: string, name: string) => invoke<SignatureMeta>("signature_rename", { id, name });
export const deleteSignature = (id: string) => invoke<void>("signature_delete", { id });

/** The full image, for placing. */
export async function getSignature(id: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("signature_get", { id }));
}

/** The strokes a drawn signature was made from (JSON, see strokes.ts `parse`), or null. */
export const getSignatureStrokes = (id: string) => invoke<string | null>("signature_strokes", { id });

/** A blob URL for PNG bytes. Revoke it when done. */
export function pngUrl(bytes: Uint8Array | number[]): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return URL.createObjectURL(new Blob([b as BlobPart], { type: "image/png" }));
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** A drawing as PNG bytes (cropped to the ink, transparent background) plus its stored form. */
export async function drawingToPng(strokes: Stroke[], colour = INK): Promise<{ png: Uint8Array; json: string } | null> {
  const plan = exportPlan(strokes);
  if (!plan) return null;
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawStrokes(ctx, strokes, { colour, width: plan.penWidth, map: plan.map });
  const png = await canvasPng(canvas);
  return png && { png, json: serialise(strokes, undefined, colour) };
}

/** A one-colour PNG (an imported signature) in another ink, alpha kept. */
export async function recolourPng(png: Uint8Array, rgb: Rgb): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }), {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolour(data.data, rgb);
  ctx.putImageData(data, 0, 0);
  const out = await canvasPng(canvas);
  if (!out) throw new Error("Couldn't recolour the signature.");
  return out;
}

/**
 * The message to show for a signature error; `verb` as for userMessage ("import this picture").
 * The signature codes' messages are in shell/messages.ts with the rest; only "not supported"
 * reads differently here (a picture, not a document).
 */
export function signatureMessage(e: unknown, verb: string): string {
  if (parseError(e).code === "not_supported") return "That file isn't a picture Vellum can read.";
  return userMessage(e, verb);
}
