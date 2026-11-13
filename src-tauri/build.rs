fn main() {
    // Our own application manifest: Tauri's (Common Controls v6) plus a Windows 10/11
    // compatibility declaration, which layered child windows need (the snap layouts overlay,
    // src/snap.rs). See app.manifest.
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build failed");
    println!("cargo:rerun-if-changed=app.manifest");
    // The icon set is embedded at build time (the exe's icon resource, and the window icon via
    // generate_context!). Cargo doesn't otherwise know about it, so a regenerated set
    // (tools/make-icons.mjs) wouldn't reach a dev build.
    println!("cargo:rerun-if-changed=icons");

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
