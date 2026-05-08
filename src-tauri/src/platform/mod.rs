/// Windows-specific platform helpers, split by responsibility.

mod badge;
mod display_affinity;
mod window_enumeration;
mod window_geometry;

pub use badge::create_monitor_badge_window;
pub use display_affinity::set_window_exclude_from_capture;
pub use window_enumeration::enumerate_visible_windows;
pub use window_geometry::get_window_restore_rect;
