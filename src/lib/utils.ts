import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { KeystrokeSegment, StepExportChoice } from '$lib/types';

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

/** Derive a monitor tab string from a step's persisted export_choice. */
export function tabFromExportChoice(choice: StepExportChoice | undefined): string {
  if (!choice || choice.type === 'Primary') return 'primary';
  if (choice.type === 'All') return 'all';
  if (choice.type === 'Extra') return `extra_${choice.value}`;
  // exhaustiveness check
  const _exhaustive: never = choice;
  return 'primary';
}

/** Map a tab value back to a StepExportChoice. */
export function choiceFromTab(tab: string): StepExportChoice {
  if (tab === 'primary') return { type: 'Primary' };
  if (tab === 'all') return { type: 'All' };
  const idx = parseInt(tab.replace('extra_', ''), 10);
  if (isNaN(idx)) return { type: 'Primary' };
  return { type: 'Extra', value: idx };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
