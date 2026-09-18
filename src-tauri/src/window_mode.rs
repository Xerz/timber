use std::ffi::OsStr;
use tauri::{PhysicalPosition, PhysicalSize};

#[cfg(windows)]
#[path = "window_lock.rs"]
mod window_lock;

pub fn is_windowed(args: impl IntoIterator<Item = impl AsRef<OsStr>>) -> bool {
    args.into_iter().any(|arg| arg.as_ref() == "--windowed")
}

fn geometry(
    monitor_x: i32,
    monitor_width: u32,
    work_area_y: i32,
    work_area_height: u32,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let width = (f64::from(monitor_width) * 0.6).round() as u32;
    let x = i64::from(monitor_x) + i64::from((monitor_width - width) / 2);
    (
        PhysicalPosition::new(x as i32, work_area_y),
        PhysicalSize::new(width, work_area_height),
    )
}

pub fn create_main_window(
    app: &tauri::App,
    windowed: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == "main")
        .ok_or("Не найдена конфигурация главного окна")?;

    let bounds = if windowed {
        let monitor = match app.primary_monitor() {
            Ok(Some(monitor)) => monitor,
            _ => app
                .available_monitors()?
                .into_iter()
                .next()
                .ok_or("Не удалось определить монитор для оконного режима")?,
        };
        let work_area = monitor.work_area();
        Some(geometry(
            monitor.position().x,
            monitor.size().width,
            work_area.position.y,
            work_area.size.height,
        ))
    } else {
        None
    };

    let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?
        .fullscreen(!windowed && config.fullscreen)
        .visible(false);
    if windowed {
        builder = builder
            .maximizable(false)
            .initialization_script("window.__DROVA_WINDOWED__ = true;");
    }
    let window = builder.build()?;
    if let Some((position, size)) = bounds {
        window.set_size(size)?;
        window.set_position(position)?;
        #[cfg(windows)]
        // setup runs on the window's thread; installation verifies this before
        // touching the subclass. The window stays hidden if installation fails.
        window_lock::install(window.hwnd()?.0 as _)?;
    }
    window.show()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_exact_windowed_flag() {
        assert!(is_windowed(["--windowed"]));
        assert!(is_windowed(["--other", "--windowed", "--windowed"]));
        assert!(!is_windowed(Vec::<String>::new()));
        assert!(!is_windowed(["windowed", "--windowed=true", "--WINDOWED"]));
    }

    #[test]
    fn centers_window_above_bottom_taskbar() {
        assert_eq!(
            geometry(0, 1920, 0, 1040),
            (PhysicalPosition::new(384, 0), PhysicalSize::new(1152, 1040))
        );
    }

    #[test]
    fn rounds_odd_width_with_at_most_one_pixel_difference_in_margins() {
        let (position, size) = geometry(0, 1367, 0, 728);
        assert_eq!(size.width, 820);
        assert_eq!(position.x, 273);
        assert_eq!(1367 - size.width - position.x as u32, 274);
    }

    #[test]
    fn respects_monitor_offset_and_top_taskbar() {
        assert_eq!(
            geometry(-1920, 1920, -160, 1040),
            (
                PhysicalPosition::new(-1536, -160),
                PhysicalSize::new(1152, 1040)
            )
        );
        assert_eq!(geometry(2560, 1920, 40, 1040).0.x, 2944);
    }

    #[test]
    fn uses_physical_pixels_without_scaling_again() {
        for (width, height) in [(1920, 1040), (2400, 1300), (2880, 1560)] {
            let (position, size) = geometry(0, width, 0, height);
            assert_eq!(size.width, width * 3 / 5);
            assert_eq!(position.x, (width / 5) as i32);
            assert_eq!(size.height, height);
        }
    }
}
