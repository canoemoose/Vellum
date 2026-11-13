//! Windows 11 snap layouts on the custom maximise button.
//!
//! Windows shows the snap layouts flyout when the window under the cursor answers
//! WM_NCHITTEST with HTMAXBUTTON. Vellum draws its own title bar in the webview, and the
//! WebView2 child window covering the client area is what Windows asks, so it never offers
//! the flyout. This places a small native child window of our own exactly over the HTML
//! maximise button (the front end reports the button's rectangle through
//! `snap_max_button`): it answers HTMAXBUTTON, maximises or restores on click, and tells the
//! front end when the pointer enters and leaves (`snap://hover`), because the HTML button
//! underneath no longer sees the mouse.
//!
//! The overlay is layered at alpha 1 of 255: invisible, but still hit-tested (a fully
//! transparent layered window would let the mouse through). Windows 10 has no snap
//! layouts; there the overlay just works as the maximise button.

#[cfg(windows)]
mod imp {
    use std::sync::{Mutex, OnceLock};
    use tauri::{AppHandle, Emitter};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::ValidateRect;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    /// Window handles kept as integers so the state can live in a static.
    struct State {
        overlay: isize,
        parent: isize,
        hovering: bool,
    }

    static STATE: Mutex<Option<State>> = Mutex::new(None);
    static APP: OnceLock<AppHandle> = OnceLock::new();

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn emit_hover(on: bool) {
        if let Some(app) = APP.get() {
            let _ = app.emit("snap://hover", on);
        }
    }

    unsafe extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            WM_NCHITTEST => {
                let mut start = false;
                if let Some(s) = STATE.lock().unwrap().as_mut() {
                    if !s.hovering {
                        s.hovering = true;
                        start = true;
                    }
                }
                if start {
                    let mut t = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE | TME_NONCLIENT,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    unsafe { TrackMouseEvent(&mut t) };
                    emit_hover(true);
                }
                HTMAXBUTTON as LRESULT
            }
            WM_NCMOUSELEAVE => {
                if let Some(s) = STATE.lock().unwrap().as_mut() {
                    s.hovering = false;
                }
                emit_hover(false);
                0
            }
            // Swallow the press so nothing starts a move or size; act on release.
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK if wparam == HTMAXBUTTON as usize => 0,
            WM_NCLBUTTONUP if wparam == HTMAXBUTTON as usize => {
                let parent = STATE.lock().unwrap().as_ref().map(|s| s.parent);
                if let Some(p) = parent {
                    let p = p as HWND;
                    let cmd = if unsafe { IsZoomed(p) } != 0 { SC_RESTORE } else { SC_MAXIMIZE };
                    unsafe { PostMessageW(p, WM_SYSCOMMAND, cmd as WPARAM, 0) };
                }
                0
            }
            // Nothing to paint: the HTML button shows through.
            WM_ERASEBKGND => 1,
            WM_PAINT => {
                unsafe { ValidateRect(hwnd, std::ptr::null()) };
                0
            }
            _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
        }
    }

    /// Create the overlay on first use, then move it over `rect` (physical pixels in the
    /// parent's client area) and back on top of the webview. Must run on the UI thread.
    pub fn place(app: &AppHandle, parent: HWND, x: i32, y: i32, w: i32, h: i32) {
        let _ = APP.set(app.clone());
        let mut guard = STATE.lock().unwrap();
        let overlay = match guard.as_ref() {
            Some(s) if s.parent == parent as isize => s.overlay as HWND,
            _ => {
                let class = wide("VellumSnapOverlay");
                unsafe {
                    let inst = GetModuleHandleW(std::ptr::null());
                    let wc = WNDCLASSW {
                        style: 0,
                        lpfnWndProc: Some(overlay_proc),
                        cbClsExtra: 0,
                        cbWndExtra: 0,
                        hInstance: inst,
                        hIcon: std::ptr::null_mut(),
                        hCursor: LoadCursorW(std::ptr::null_mut(), IDC_ARROW),
                        hbrBackground: std::ptr::null_mut(),
                        lpszMenuName: std::ptr::null(),
                        lpszClassName: class.as_ptr(),
                    };
                    RegisterClassW(&wc); // fails harmlessly if already registered
                    let hwnd = CreateWindowExW(
                        WS_EX_LAYERED | WS_EX_NOACTIVATE,
                        class.as_ptr(),
                        std::ptr::null(),
                        WS_CHILD | WS_VISIBLE,
                        x,
                        y,
                        w,
                        h,
                        parent,
                        std::ptr::null_mut(),
                        inst,
                        std::ptr::null(),
                    );
                    if hwnd.is_null() {
                        let err = windows_sys::Win32::Foundation::GetLastError();
                        eprintln!("[snap] could not create the maximise button overlay (error {err}); no snap layouts");
                        return;
                    }
                    SetLayeredWindowAttributes(hwnd, 0, 1, LWA_ALPHA);
                    *guard = Some(State { overlay: hwnd as isize, parent: parent as isize, hovering: false });
                    hwnd
                }
            }
        };
        drop(guard);
        unsafe {
            SetWindowPos(overlay, HWND_TOP, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }

    /// Hide the overlay (no button to cover, e.g. a dialog took over the title bar).
    pub fn hide() {
        if let Some(s) = STATE.lock().unwrap().as_ref() {
            unsafe { ShowWindow(s.overlay as HWND, SW_HIDE) };
        }
    }
}

/// Put the snap overlay over the maximise button: `x, y, w, h` in physical pixels from the
/// window's top-left (CSS pixels times devicePixelRatio). A zero size hides it.
#[tauri::command]
pub fn snap_max_button(app: tauri::AppHandle, window: tauri::WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
    #[cfg(windows)]
    {
        let Ok(hwnd) = window.hwnd() else { return };
        let parent = hwnd.0 as isize;
        let a = app.clone();
        let _ = app.run_on_main_thread(move || {
            if w <= 0.0 || h <= 0.0 {
                imp::hide();
            } else {
                imp::place(&a, parent as windows_sys::Win32::Foundation::HWND, x.round() as i32, y.round() as i32, w.round() as i32, h.round() as i32);
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (app, window, x, y, w, h);
    }
}
