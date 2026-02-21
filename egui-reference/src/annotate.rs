use crate::model::ClickPoint;
use image::{ImageBuffer, Rgba, RgbaImage};
use imageproc::drawing::draw_hollow_circle_mut;

/// Draw an orange click-indicator ring around `click` on `image` (in-place).
///
/// Three concentric circles are drawn for visibility on any background.
pub fn draw_click_indicator(image: &mut RgbaImage, click: &ClickPoint) {
    let cx = click.x as i32;
    let cy = click.y as i32;
    let orange = Rgba([255u8, 140u8, 0u8, 255u8]);

    for r in [18i32, 20, 22] {
        draw_hollow_circle_mut(image, (cx, cy), r, orange);
    }

    // Small filled center dot for precision
    fill_circle(image, cx, cy, 4, orange);
}

fn fill_circle(image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>, cx: i32, cy: i32, r: i32, color: Rgba<u8>) {
    let (w, h) = image.dimensions();
    for dy in -r..=r {
        for dx in -r..=r {
            if dx * dx + dy * dy <= r * r {
                let px = cx + dx;
                let py = cy + dy;
                if px >= 0 && py >= 0 && px < w as i32 && py < h as i32 {
                    image.put_pixel(px as u32, py as u32, color);
                }
            }
        }
    }
}
