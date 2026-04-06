/**
 * Obfuscation effect helpers: gaussian blur and pixelate.
 *
 * These functions are extracted from FabricCanvasWrapper to keep the main
 * class focused on orchestration. They operate on raw canvas/image data and
 * return a PNG data URL that the caller places onto the Fabric canvas.
 */

/** Shared region geometry, clamped to image bounds. */
export interface ObfuscationRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Clamp and validate a region against image dimensions.
 * Returns null if the resulting region is too small to render.
 */
export function clampRegion(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  imageWidth: number,
  imageHeight: number,
): ObfuscationRegion | null {
  const left = Math.max(0, Math.min(sx, ex));
  const top = Math.max(0, Math.min(sy, ey));
  const width = Math.min(Math.abs(ex - sx), imageWidth - left);
  const height = Math.min(Math.abs(ey - sy), imageHeight - top);
  if (width < 4 || height < 4) return null;
  return { left, top, width, height };
}

/**
 * Clamp an existing overlay's bounding box against image bounds.
 * Returns null if too small.
 */
export function clampOverlayRegion(
  left: number,
  top: number,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
): ObfuscationRegion | null {
  const clampedLeft = Math.max(0, Math.min(left, imageWidth - 1));
  const clampedTop = Math.max(0, Math.min(top, imageHeight - 1));
  const clampedW = Math.min(width, imageWidth - clampedLeft);
  const clampedH = Math.min(height, imageHeight - clampedTop);
  if (clampedW < 4 || clampedH < 4) return null;
  return { left: clampedLeft, top: clampedTop, width: clampedW, height: clampedH };
}

/**
 * Render a gaussian-blurred copy of a region from bgEl.
 * Returns a PNG data URL of the blurred region at natural pixel size.
 */
export function renderBlurRegion(
  bgEl: HTMLImageElement,
  region: ObfuscationRegion,
  radius: number,
  imageWidth: number,
  imageHeight: number,
): string {
  const { left, top, width, height } = region;

  // Add padding to avoid edge artifacts from the CSS blur filter.
  const pad = radius * 2;
  const padLeft = Math.max(0, left - pad);
  const padTop = Math.max(0, top - pad);
  const padRight = Math.min(imageWidth, left + width + pad);
  const padBottom = Math.min(imageHeight, top + height + pad);
  const padW = padRight - padLeft;
  const padH = padBottom - padTop;

  // Apply blur to a padded canvas first.
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = padW;
  tempCanvas.height = padH;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.filter = `blur(${radius}px)`;
  tempCtx.drawImage(bgEl, padLeft, padTop, padW, padH, 0, 0, padW, padH);
  tempCtx.filter = 'none';

  // Crop out just the requested region from the blurred padded canvas.
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(tempCanvas, left - padLeft, top - padTop, width, height, 0, 0, width, height);

  return offscreen.toDataURL('image/png');
}

/**
 * Render a pixelated copy of a region from bgEl.
 * Returns a PNG data URL of the pixelated region at natural pixel size.
 */
export function renderPixelateRegion(
  bgEl: HTMLImageElement,
  region: ObfuscationRegion,
  blockSize: number,
): string {
  const { left, top, width, height } = region;

  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext('2d')!;
  ctx.drawImage(bgEl, left, top, width, height, 0, 0, width, height);

  // Downsample.
  const smallW = Math.max(1, Math.ceil(width / blockSize));
  const smallH = Math.max(1, Math.ceil(height / blockSize));
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = smallW;
  smallCanvas.height = smallH;
  const smallCtx = smallCanvas.getContext('2d')!;
  smallCtx.drawImage(offscreen, 0, 0, smallW, smallH);

  // Upsample with nearest-neighbor (no smoothing = pixel-art look).
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, width, height);

  return offscreen.toDataURL('image/png');
}
