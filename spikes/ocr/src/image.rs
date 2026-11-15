//! Pure image helpers applied to a tile before OCR.

/// Mean brightness of an 8-bit greyscale image, 0..=255 (sampling every 4th pixel of every
/// 4th row: plenty for a page tile).
pub fn mean(px: &[u8], w: u32, h: u32, stride: usize) -> f32 {
    let (mut sum, mut n) = (0u64, 0u64);
    for y in (0..h as usize).step_by(4) {
        for x in (0..w as usize).step_by(4) {
            sum += px[y * stride + x] as u64;
            n += 1;
        }
    }
    if n == 0 { 255.0 } else { sum as f32 / n as f32 }
}

/// Mostly dark: light text on a dark ground (a blueprint, a negative scan), which Windows OCR
/// reads poorly until inverted.
pub fn is_dark(px: &[u8], w: u32, h: u32, stride: usize) -> bool {
    mean(px, w, h, stride) < 110.0
}

pub fn invert(px: &mut [u8]) {
    for p in px {
        *p = 255 - *p;
    }
}
