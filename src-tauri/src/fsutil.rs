//! Writing files that are about to be renamed over something that matters.
//!
//! "Write a temporary file, then rename it into place" only protects against a crash if the
//! temporary file's bytes are on the disk before the rename. Windows records the rename in
//! the file system's journal straight away but may still hold the contents in memory, so a
//! power cut or a blue screen just after could leave the new name over empty or partial
//! contents, with the original already gone. Flushing first closes that gap.

use std::io::Write;
use std::path::Path;

/// Write `bytes` to `path` and flush them to the disk before returning.
pub fn write_flushed(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut f = std::fs::File::create(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}

/// Flush a file already written (a copy, say) to the disk.
pub fn flush(path: &Path) -> std::io::Result<()> {
    std::fs::OpenOptions::new().write(true).open(path)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_replaces_whole_files() {
        let dir = std::env::temp_dir().join(format!("vellum-fsutil-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.bin");
        write_flushed(&p, b"first, and longer").unwrap();
        write_flushed(&p, b"second").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"second");
        flush(&p).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"second");
        assert!(write_flushed(&dir.join("missing").join("b.bin"), b"x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
