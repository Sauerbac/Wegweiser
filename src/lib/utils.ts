import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KeystrokeSegment, MonitorInfo } from '$lib/types';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Count keystrokes in a keystroke string.
 * Bracket tokens [Ctrl+C] count as 1 shortcut each;
 * non-bracket plain character runs each count as their character length.
 */
export function countKeystrokes(raw: string | null): number {
  if (!raw) return 0;
  let count = 0;
  const parts = raw.split(/(\[[^\]]+\])/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('[') && part.endsWith(']')) {
      count += 1;
    } else {
      count += part.length;
    }
  }
  return count;
}

/**
 * Parse a keystroke string into an array of segments.
 * Each segment is either a shortcut (rendered as <kbd>) or plain text.
 */
export function parseKeystrokes(raw: string): KeystrokeSegment[] {
  const segments: KeystrokeSegment[] = [];
  const parts = raw.split(/(\[[^\]]+\])/);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('[') && part.endsWith(']')) {
      const inner = part.slice(1, -1);
      const isSingleChar = inner.length === 1;
      if (!isSingleChar || inner === '+') {
        segments.push({ kind: 'shortcut', key: inner });
      } else {
        segments.push({ kind: 'text', value: inner });
      }
    } else {
      segments.push({ kind: 'text', value: part });
    }
  }
  return segments;
}

/** Return a human-readable label for a monitor by its index (1-based number prefix + name). */
export function monitorLabel(monitors: MonitorInfo[], idx: number): string {
  const num = idx + 1;
  const name = monitors[idx]?.name;
  return name ? `${num} | ${name}` : `Monitor ${num}`;
}

/** Return 's' when count !== 1, '' otherwise — for simple English plural suffixes. */
export function pluralS(count: number): string {
  return count !== 1 ? 's' : '';
}

/** Extract the numeric index from an 'extra_N' tab string. */
export function extraTabIndex(tab: string): number {
  return parseInt(tab.replace('extra_', ''), 10);
}

/** Read a CSS custom property from the document root (resolves theme variables). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Clip a WindowRect to image bounds.
 * Returns the clipped rectangle, or null if the rect has no visible area.
 */
export function clipRect(
  wr: { x: number; y: number; w: number; h: number },
  imageW: number,
  imageH: number,
): { x: number; y: number; w: number; h: number } | null {
  const cx = Math.max(wr.x, 0);
  const cy = Math.max(wr.y, 0);
  const cw = Math.min(wr.x + wr.w, imageW) - cx;
  const ch = Math.min(wr.y + wr.h, imageH) - cy;
  if (cw <= 0 || ch <= 0) return null;
  return { x: cx, y: cy, w: cw, h: ch };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
