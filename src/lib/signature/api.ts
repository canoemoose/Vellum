// The signature commands (src-tauri/src/signature) and the browser-side PNG export of a
// drawing. Components call these; nothing here is Svelte.

import { invoke } from "@tauri-apps/api/core";
import { parseError, userMessage } from "../shell/messages";
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

/** Knock the paper out of a photo or scan: PNG bytes with transparency. */
export async function importSignature(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("signature_import", { path }));
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

/** A drawing as PNG bytes (cropped to the ink, transparent background) plus its stored form. */
export async function drawingToPng(strokes: Stroke[]): Promise<{ png: Uint8Array; json: string } | null> {
  const plan = exportPlan(strokes);
  if (!plan) return null;
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawStrokes(ctx, strokes, { colour: INK, width: plan.penWidth, map: plan.map });
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), json: serialise(strokes) };
}

const MESSAGES: Record<string, string> = {
  signature_no_ink: "Couldn't find a signature in that picture. Sign in dark ink on plain paper and fill the frame with it.",
  heic_codec_missing:
    "Windows can't read this HEIC photo. Install HEIF Image Extensions and HEVC Video Extensions from the Microsoft Store, or save the photo as a JPEG.",
  signature_too_small: "That picture is too small to use.",
  signature_too_large: "That signature is too large to keep.",
  signature_unreadable: "This signature couldn't be read. It may have been saved by another Windows account.",
  signature_not_found: "That signature isn't in the library any more.",
};

/** The message to show for a signature error; `verb` as for userMessage ("import this picture"). */
export function signatureMessage(e: unknown, verb: string): string {
  const { code } = parseError(e);
  if (code === "not_supported") return "That file isn't a picture Vellum can read.";
  return (code && MESSAGES[code]) || userMessage(e, verb);
}
