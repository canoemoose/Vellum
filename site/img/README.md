# Homepage images

Every image `site/index.html` uses. The files committed here are labelled placeholders at the
final pixel size; replace each with the real capture under the same name. The page works with
the placeholders, so they can be swapped one at a time.

## Rules for every screenshot

- **Free to publish.** Only the fictional Fieldwork Festival drawing set
  (`test-files/fieldwork-festival-drawing-set.pdf`) or the synthetic PDFs. No drawings from
  real jobs.
- **As captured, with real transparency.** Rounded window corners and the Windows shadow on a
  transparent background. The page adds no frame, border or shadow of its own, so it relies
  on the capture's.
- **Light and dark.** Shots marked "both" need a `-dark` and a `-light` file, taken with the
  app's View > Theme set to match. The page picks one from the visitor's system theme.
- **WebP, keeping the alpha channel, under about 300 KB each.** From the PNG capture:

  ```bash
  ffmpeg -i hero-dark.png -c:v libwebp -quality 88 -pix_fmt yuva420p hero-dark.webp
  ```

  Lower `-quality` if a file comes out over 300 KB; check the corners still look clean.
- Sizes below are in device pixels. "Display" is the widest the page shows the image, in CSS
  pixels; captures are about twice that so they stay sharp on high-DPI screens.
- The page credits the map data under every screenshot of the festival set, so nothing needs
  adding to the images themselves.

## The images

| File | Shows | Capture size | Display | Themes |
| --- | --- | --- | --- | --- |
| `hero-{dark,light}.webp` | Sheet 002 (event layout overall, A1 1:2500), Fit page. The first thing people see: dense and legible. | 1440 x 900 window at 1.5x: 2146 x 1343 as captured | 1170 | both |
| `detail-{dark,light}.webp` | Sheet 003 (main arena) zoomed right in: barrier units and fence panels crisp. Tile: "Quick on big drawings". | as hero | 490 | both |
| `site-{dark,light}.webp` | Sheet 001 (site plan) zoomed in, with the mini map showing. Tile: "Moves like CAD". | as hero | 490 | both |
| `measure-{dark,light}.webp` | Sheet 004 (stage plan, A3 1:100) with two length measurements; status bar showing the scale. Tile: "Real-world scale and measuring". | as hero | 490 | both |
| `markup-{dark,light}.webp` | A revision cloud and a text box; ideally a stamp or signature in view too, as the tile covers all three. Tile: "Markup, stamps and signatures". | as hero | 490 | both |
| `print-{dark,light}.webp` | The print dialog, To scale with a real ratio (1:500 or similar) on the preview. Tile: "Prints to scale". | as hero | 490 | both |
| `image-{dark,light}.webp` | **Not in the screenshot list yet.** A raster image open (PNG, JPEG or TIFF), so the tab shows an image file. A free-to-publish one: for example the site plan's map exported as a PNG, or a public-domain scanned drawing. Tile: "Images too". | as hero | 490 | both |
| `smartscreen.webp` | **Taken by hand on a real install.** Windows' "Windows protected your PC" dialog after pressing "More info", so "Run anyway" and "Publisher: Unknown publisher" are showing, for the 0.2.0 installer. Crop to the dialog. | about 2x the dialog | 400 | one (Windows draws it in its own colours) |
| `og.png` | Link preview for messages (Open Graph and Twitter card). Dark background (`#141517` to `#1b1c1f`), the icon, "Vellum", the line "A fast PDF and image viewer for people who open drawings, not documents.", and a crop of the dark hero. Keep text inside the middle 1000 x 500, as some apps crop the edges. **PNG, not WebP**: not every messaging app reads WebP previews. | exactly 1200 x 630 | (preview only) | dark only |

The favicon and the header icon are copied from `src-tauri/icons` by `tools/build-site.mjs`,
so they need nothing here.
