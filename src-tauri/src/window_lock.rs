//! Windows-only geometry lock. Installed once, on the owning window thread.
use std::io;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{
            EnableMenuItem, GetSystemMenu, GetWindowRect, GetWindowThreadProcessId, IsIconic,
            MF_BYCOMMAND, MF_GRAYED, SC_MAXIMIZE, SC_MOVE, SC_SIZE, SWP_NOMOVE, SWP_NOSIZE,
            WINDOWPOS, WM_INITMENUPOPUP, WM_NCDESTROY, WM_SYSCOMMAND, WM_WINDOWPOSCHANGING,
        },
    },
};

const SUBCLASS_ID: usize = 0x44524F56;

pub fn install(hwnd: HWND) -> io::Result<()> {
    // SAFETY: the handle comes from Tauri and remains alive during setup.
    // Win32 subclass helpers must only be called by the window's owning thread.
    unsafe {
        if GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) != GetCurrentThreadId() {
            return Err(io::Error::other(
                "Блокировка окна вызвана не из потока окна",
            ));
        }
        let mut bounds = RECT::default();
        if GetWindowRect(hwnd, &mut bounds) == 0 {
            return Err(io::Error::last_os_error());
        }
        let state = Box::into_raw(Box::new(bounds));
        if SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, state as usize) == 0 {
            drop(Box::from_raw(state));
            return Err(io::Error::other(
                "Не удалось установить блокировку положения окна",
            ));
        }
        disable_geometry_commands(hwnd);
    }
    Ok(())
}

unsafe fn disable_geometry_commands(hwnd: HWND) {
    let menu = GetSystemMenu(hwnd, 0);
    if !menu.is_null() {
        for command in [SC_MOVE, SC_SIZE, SC_MAXIMIZE] {
            EnableMenuItem(menu, command, MF_BYCOMMAND | MF_GRAYED);
        }
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    subclass_id: usize,
    data: usize,
) -> LRESULT {
    // SAFETY: data is the Box<RECT> owned by this subclass until WM_NCDESTROY.
    // Never keep references to it across DefSubclassProc (which can reenter).
    match message {
        WM_SYSCOMMAND if matches!(wparam as u32 & 0xfff0, SC_MOVE | SC_SIZE | SC_MAXIMIZE) => {
            return 0;
        }
        WM_WINDOWPOSCHANGING if IsIconic(hwnd) == 0 && lparam != 0 => {
            let bounds = &*(data as *const RECT);
            let proposed = &mut *(lparam as *mut WINDOWPOS);
            if proposed.flags & SWP_NOMOVE == 0 {
                proposed.x = bounds.left;
                proposed.y = bounds.top;
            }
            if proposed.flags & SWP_NOSIZE == 0 {
                proposed.cx = bounds.right - bounds.left;
                proposed.cy = bounds.bottom - bounds.top;
            }
            // Do not let DefWindowProc adjust these bounds again. Activation,
            // visibility and z-order flags are untouched. Minimized windows
            // take the default path, including Windows' offscreen placement.
            return 0;
        }
        WM_INITMENUPOPUP => {
            let result = DefSubclassProc(hwnd, message, wparam, lparam);
            // The default procedure can re-enable commands when opening a menu.
            disable_geometry_commands(hwnd);
            return result;
        }
        WM_NCDESTROY => {
            RemoveWindowSubclass(hwnd, Some(window_proc), subclass_id);
            drop(Box::from_raw(data as *mut RECT));
        }
        _ => {}
    }
    DefSubclassProc(hwnd, message, wparam, lparam)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetMenuState, SendMessageW, SetWindowPos, ShowWindow,
        SC_MINIMIZE, SC_RESTORE, SWP_NOACTIVATE, SWP_NOZORDER, SW_MINIMIZE, SW_RESTORE,
        WS_OVERLAPPEDWINDOW,
    };

    struct TestWindow(HWND);

    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe { DestroyWindow(self.0) };
        }
    }

    fn bounds(hwnd: HWND) -> (i32, i32, i32, i32) {
        let mut rect = RECT::default();
        assert_ne!(unsafe { GetWindowRect(hwnd, &mut rect) }, 0);
        (rect.left, rect.top, rect.right, rect.bottom)
    }

    #[test]
    fn blocks_geometry_changes_but_allows_minimize_and_restore() {
        unsafe {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_OVERLAPPEDWINDOW,
                100,
                100,
                600,
                400,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!hwnd.is_null());
            let _window = TestWindow(hwnd);
            let initial = bounds(hwnd);
            install(hwnd).unwrap();
            assert_ne!(
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    300,
                    250,
                    800,
                    500,
                    SWP_NOACTIVATE | SWP_NOZORDER
                ),
                0
            );
            assert_eq!(bounds(hwnd), initial);
            for command in [SC_MOVE, SC_SIZE, SC_MAXIMIZE] {
                assert_ne!(
                    GetMenuState(GetSystemMenu(hwnd, 0), command, MF_BYCOMMAND) & MF_GRAYED,
                    0
                );
                SendMessageW(hwnd, WM_SYSCOMMAND, command as usize, 0);
                assert_eq!(bounds(hwnd), initial);
            }
            for _ in 0..3 {
                ShowWindow(hwnd, SW_MINIMIZE);
                assert_ne!(IsIconic(hwnd), 0);
                ShowWindow(hwnd, SW_RESTORE);
                assert_eq!(IsIconic(hwnd), 0);
                assert_eq!(bounds(hwnd), initial);
                SendMessageW(hwnd, WM_SYSCOMMAND, SC_MINIMIZE as usize, 0);
                assert_ne!(IsIconic(hwnd), 0);
                SendMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE as usize, 0);
                assert_eq!(IsIconic(hwnd), 0);
                assert_eq!(bounds(hwnd), initial);
            }
        }
    }
}
