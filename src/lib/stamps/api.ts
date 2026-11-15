// The image stamps library (src-tauri/src/stamps.rs) and turning library entries into what a
// stamp holds. Components call these; nothing here is Svelte.

import { invoke } from "@tauri-apps/api/core";
import { getSignature, getSignatureStrokes, type SignatureItem } from "../signature/api";
import { parse } from "../signature/strokes";
import { type StampContent, fromBase64, imageContent, strokesContent } from "../markup/stamps";

export interface StampItem {
  id: string;
  name: string;
  width: number;
  height: number;
  createdMs: number;
  /** Preview PNG bytes. */
  thumb: number[];
}

/** Picture types offered when adding an image stamp. */
export const STAMP_EXTENSIONS = ["png", "jpg", "jpeg"];

export const listStamps = () => invoke<StampItem[]>("stamp_list");
export const addStamp = (path: string) => invoke<StampItem>("stamp_add", { path });
export const deleteStamp = (id: string) => invoke<void>("stamp_delete", { id });

export async function getStamp(id: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("stamp_get", { id }));
}

/** What placing a library signature puts on the page: its strokes if drawn (crisp at any zoom), else its picture. */
export async function signatureContent(item: SignatureItem): Promise<StampContent | null> {
  if (item.kind === "drawn") {
    const json = await getSignatureStrokes(item.id);
    const d = json ? parse(json) : null;
    const c = d ? strokesContent(d) : null;
    if (c) return c;
  }
  return imageContent(await getSignature(item.id));
}

/** An image stamp's content. */
export async function stampContent(item: StampItem): Promise<StampContent | null> {
  return imageContent(await getStamp(item.id));
}

// Stage 8: the Image tool

/** Picture types the Image tool opens (whatever the backend's `image` crate reads). */
export const PICTURE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp", "gif"];

/** A picture as the clipboard and the Image tool hand it over: PNG base64, at most 2000 px on its long side. */
export interface Picture {
  png: string;
  w: number;
  h: number;
}

/** A picture file, scaled to the size limit on the way in (src-tauri/src/clipboard.rs, picture_open). */
export async function openPicture(path: string): Promise<Picture> {
  const r = await invoke<{ kind: string } & Partial<Picture>>("picture_open", { path });
  if (r.kind !== "picture" || !r.png) throw new Error("[picture_unreadable] not a picture");
  return { png: r.png, w: r.w ?? 0, h: r.h ?? 0 };
}

/** A picture's content, ready to place. */
export const pictureContent = (p: Picture): Promise<StampContent | null> => imageContent(fromBase64(p.png));
