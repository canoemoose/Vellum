fn main() {
    tauri_build::build();

    // tauri-build links the Windows resource (icon + application manifest) into the app
    // binary only. Unit-test binaries link the dialog plugin too, which imports
    // TaskDialogIndirect from Common Controls v6; without the manifest they fail to load
    // with STATUS_ENTRYPOINT_NOT_FOUND. Link the same resource into test binaries.
    if std::env::var("CARGO_CFG_WINDOWS").is_ok() {
        let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        for name in ["resource.lib", "libresource.a"] {
            let p = out.join(name);
            if p.exists() {
                println!("cargo:rustc-link-arg-tests={}", p.display());
                break;
            }
        }
    }
}
