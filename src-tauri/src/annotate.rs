use crate::model::ClickPoint;
use image::{Rgba, RgbaImage};

/// Draw a radial-gradient click indicator on `image` (in-place).
///
/// The indicator is centred on `click` and uses an amber glow that fades
/// outward from a solid filled core. Alpha is blended into the existing pixel
/// colour so the indicator reads correctly on any background.
///
/// Visual design:
/// - Core (r ≤ 6 px): solid filled dot at ~85 % opacity.
/// - Outer glow (6–40 px): quadratic falloff from 85 % → 0 %.
/// - Colour: `--chart-5` light-theme value (oklch 0.769 0.188 70.08
///   ≈ rgb(254, 153, 0)), hardcoded so it is stable across light/dark themes.
pub fn draw_click_indicator(image: &mut RgbaImage, click: &ClickPoint) {
    const R: f32 = 40.0; // outer glow radius (pixels)
    const R_PEAK: f32 = 6.0; // solid-core radius

    // Amber matching --chart-5 light: oklch(0.769 0.188 70.08) ≈ rgb(254, 153, 0)
    const OR: f32 = 254.0;
    const OG: f32 = 154.0;
    const OB: f32 = 0.0;

    let cx = click.x as i32;
    let cy = click.y as i32;
    let ri = R as i32;
    let (w, h) = image.dimensions();

    for dy in -ri..=ri {
        for dx in -ri..=ri {
            let dist = ((dx * dx + dy * dy) as f32).sqrt();
            if dist > R {
                continue;
            }

            // Compute alpha for this pixel.
            //
            // Two zones:
            //   r ≤ R_PEAK → solid filled core at 85 % opacity
            //   R_PEAK < r ≤ R → quadratic falloff from 85 % → 0 %
            let alpha: f32 = if dist <= R_PEAK {
                0.85 // solid filled dot
            } else {
                // quadratic falloff for a soft outer glow
                let t = (dist - R_PEAK) / (R - R_PEAK); // 0 at core edge, 1 at outer edge
                0.85 * (1.0 - t).powi(2)
            };

            if alpha <= 0.0 {
                continue;
            }

            let px = cx + dx;
            let py = cy + dy;
            if px < 0 || py < 0 || px >= w as i32 || py >= h as i32 {
                continue;
            }

            // Alpha-blend the orange indicator over the existing pixel.
            let existing = image.get_pixel(px as u32, py as u32);
            let [er, eg, eb, ea] = existing.0.map(|c| c as f32);
            let ea_norm = ea / 255.0;

            // Standard "source over" compositing:
            //   out_a = alpha + ea_norm * (1 - alpha)
            //   out_c = (alpha * src_c + ea_norm * (1 - alpha) * dst_c) / out_a
            let out_a = alpha + ea_norm * (1.0 - alpha);
            let (out_r, out_g, out_b) = if out_a > 0.0 {
                let inv = ea_norm * (1.0 - alpha) / out_a;
                let fwd = alpha / out_a;
                (
                    (fwd * OR + inv * er).round().clamp(0.0, 255.0),
                    (fwd * OG + inv * eg).round().clamp(0.0, 255.0),
                    (fwd * OB + inv * eb).round().clamp(0.0, 255.0),
                )
            } else {
                (er, eg, eb)
            };

            image.put_pixel(
                px as u32,
                py as u32,
                Rgba([
                    out_r as u8,
                    out_g as u8,
                    out_b as u8,
                    (out_a * 255.0).round().clamp(0.0, 255.0) as u8,
                ]),
            );
        }
    }
}
