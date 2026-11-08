// Image documents (JPEG, PNG, WebP, TIFF, BMP, GIF): decoded and resampled in Rust
// (src-tauri/src/imagedoc.rs) behind the same doc_* commands as PDFs, so this is the shared
// BackendRenderer under another name.
//
// Owned by WP-Images from v0.1 phase 1 on. Keep IMAGE_EXTENSIONS in step with
// imagedoc::EXTENSIONS on the Rust side.

import { BackendRenderer } from "./backendRenderer";

/** Lower case, no dot. */
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif"];

export function isImagePath(path: string): boolean {
  const m = /\.([^.\\/]+)$/.exec(path);
  return !!m && IMAGE_EXTENSIONS.includes(m[1].toLowerCase());
}

export class ImageRenderer extends BackendRenderer {
  readonly name = "image" as const;
}
