// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK crashes with "Error 71 (Protocol error)" on some Wayland compositors;
    // default to XWayland on Linux unless the user chose a backend themselves.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        // WebKitGTK's dmabuf renderer fails under XWayland ("Failed to create GBM buffer"),
        // leaving a blank window. Disable it unless the user configured otherwise.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    nivalis_save_editor_lib::run()
}
