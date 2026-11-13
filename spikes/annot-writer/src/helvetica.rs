//! Helvetica metrics (the standard-14 font, so nothing is embedded) and line breaking.
//!
//! Widths are in 1/1000 em from Adobe's Helvetica AFM, for printable ASCII and the WinAnsi
//! characters a measurement label needs. The brief wants line breaking to be one pure function
//! shared by the overlay and the writer; this is its first cut.

/// Width of a WinAnsi byte in 1/1000 em.
pub fn glyph_width(b: u8) -> u16 {
    const ASCII: [u16; 95] = [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space .. /
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0..9
        278, 278, 584, 584, 584, 556, 1015, // : ; < = > ? @
        667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, // A..M
        722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // N..Z
        278, 278, 278, 469, 556, 333, // [ \ ] ^ _ `
        556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, // a..m
        556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // n..z
        334, 260, 334, 584, // { | } ~
    ];
    match b {
        0x20..=0x7e => ASCII[(b - 0x20) as usize],
        0xb0 => 400, // degree
        0xb1 => 584, // plusminus
        0xb2 => 333, // twosuperior
        0xb3 => 333, // threesuperior
        0xd7 => 584, // multiply
        0x96 => 556, // endash
        0x97 => 1000, // emdash
        _ => 556,
    }
}

/// Encode text as WinAnsi; characters outside it become '?'. Non-Latin text needs an embedded
/// font, which is out of scope for the first cut (see the brief).
pub fn to_winansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| match c as u32 {
            0x20..=0x7e => c as u8,
            0xa0..=0xff => c as u32 as u8,
            0x2013 => 0x96,
            0x2014 => 0x97,
            0x2018 => 0x91,
            0x2019 => 0x92,
            0x201c => 0x93,
            0x201d => 0x94,
            0x2022 => 0x95,
            0x20ac => 0x80,
            _ => b'?',
        })
        .collect()
}

/// Width of a string in points at `size`.
pub fn width(s: &str, size: f64) -> f64 {
    to_winansi(s).iter().map(|&b| glyph_width(b) as f64).sum::<f64>() * size / 1000.0
}

/// Greedy word wrap to `max` points. Explicit newlines start a new line; a word longer than
/// the line is broken between characters.
pub fn wrap(text: &str, max: f64, size: f64) -> Vec<String> {
    let mut out = Vec::new();
    for para in text.split('\n') {
        let mut line = String::new();
        for word in para.split(' ') {
            let candidate = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
            if width(&candidate, size) <= max || line.is_empty() && width(word, size) <= max {
                line = candidate;
                continue;
            }
            if !line.is_empty() {
                out.push(std::mem::take(&mut line));
            }
            // Break an over-long word.
            let mut piece = String::new();
            for ch in word.chars() {
                let next = format!("{piece}{ch}");
                if width(&next, size) > max && !piece.is_empty() {
                    out.push(std::mem::take(&mut piece));
                    piece.push(ch);
                } else {
                    piece = next;
                }
            }
            line = piece;
        }
        out.push(line);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_match_the_afm_for_known_strings() {
        // "Hello" = 722 + 556 + 222 + 222 + 556 = 2278 at 1000 units.
        assert!((width("Hello", 1000.0) - 2278.0).abs() < 1e-9);
        assert!((width("12.5 m\u{b2}", 10.0) - (556.0 * 3.0 + 278.0 * 2.0 + 833.0 + 333.0) / 100.0).abs() < 1e-9);
    }

    #[test]
    fn wraps_on_words_and_breaks_long_words() {
        let lines = wrap("Check this bolt before the show", 80.0, 10.0);
        assert!(lines.len() > 1);
        assert!(lines.iter().all(|l| width(l, 10.0) <= 80.0));
        assert_eq!(lines.join(" "), "Check this bolt before the show");
        let long = wrap("Supercalifragilistic", 40.0, 10.0);
        assert!(long.len() > 1 && long.iter().all(|l| width(l, 10.0) <= 40.0));
        assert_eq!(wrap("a\nb", 100.0, 10.0), vec!["a", "b"]);
    }
}
