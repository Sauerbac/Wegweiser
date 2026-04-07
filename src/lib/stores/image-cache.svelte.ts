import { invoke } from '@tauri-apps/api/core';
import type { Step } from '$lib/types';

/**
 * Manages the reactive image caches for step screenshots.
 *
 * Extracted from AppStore to give the cache a single-responsibility home
 * and reduce AppStore's property count.
 */
export class ImageCacheStore {
  /**
   * Cache for primary step display images.
   * When a step has a preview_path (annotations baked in), this stores the preview.
   * Otherwise it stores the base image_path.
   * Key: `${step.id}_v${step.image_version}` → asset URI.
   */
  imageCache = $state<Record<string, string>>({});
  /** Cache for extra monitor images. Key: `${step.id}_extra_${monitorIndex}_v${ver}` → asset URI. */
  extraImageCache = $state<Record<string, string>>({});
  /**
   * Cache for raw base images (without annotations).
   * Used by the annotation editor to load the un-annotated background.
   * Key: `${step.id}_base_v${step.image_version}` → asset URI.
   */
  baseImageCache = $state<Record<string, string>>({});
  /**
   * Stable display URI per step ID — the last successfully loaded primary image URI.
   * Updated atomically when a new image finishes loading. Never cleared on cache
   * invalidation (only on clearAll or when a new URI has loaded), so the previous
   * image stays visible while a replacement loads — preventing blank-frame flicker
   * on annotation undo and editor exit.
   * Key: step.id → asset URI.
   */
  stepDisplayUri = $state<Record<number, string>>({});

  /**
   * Tracks the display path (preview_path ?? image_path) that was last loaded for each step.
   * Used to detect when undo/redo changes the displayed file even if image_version is unchanged,
   * so preloadStepImages can force-reload without first clearing (which would cause flicker).
   */
  private _loadedDisplayPath = new Map<number, string>();

  /** Build the versioned primary image cache key for a step. */
  imageCacheKey(step: Step): string {
    return `${step.id}_v${step.image_version ?? 0}`;
  }

  /** Build the cache key for an extra monitor image. */
  extraImageKey(stepId: number, monitorIndex: number, version = 0): string {
    return `${stepId}_extra_${monitorIndex}_v${version}`;
  }

  /** Build the cache key for the raw base image (editor background). */
  baseImageKey(step: Step): string {
    return `${step.id}_base_v${step.image_version ?? 0}`;
  }

  /**
   * Remove all versioned cache entries for a given step ID (all versions).
   * stepDisplayUri is intentionally NOT cleared here — it keeps the last-known
   * image visible while the replacement loads, preventing flicker.
   */
  clearStepImageCache(stepId: number) {
    const prefix = `${stepId}_`;
    for (const key of Object.keys(this.imageCache)) {
      if (key.startsWith(prefix)) delete this.imageCache[key];
    }
    for (const key of Object.keys(this.extraImageCache)) {
      if (key.startsWith(prefix)) delete this.extraImageCache[key];
    }
    for (const key of Object.keys(this.baseImageCache)) {
      if (key.startsWith(prefix)) delete this.baseImageCache[key];
    }
    this._loadedDisplayPath.delete(stepId);
  }

  /** Reset all image caches (call when starting a new recording or navigating back). */
  clearAll() {
    this.imageCache = {};
    this.extraImageCache = {};
    this.baseImageCache = {};
    this.stepDisplayUri = {};
    this._loadedDisplayPath.clear();
  }

  /**
   * Eagerly pre-load images for all steps not yet in cache.
   * Safe to call on every session-updated event — skips already-cached entries.
   *
   * For display (imageCache): loads preview_path if available, otherwise image_path.
   * For editor (baseImageCache): always loads image_path (raw, un-annotated).
   */
  preloadStepImages(steps: Step[]) {
    for (const step of steps) {
      // Display image (preview if available, else base).
      const displayKey = this.imageCacheKey(step);
      const displayPath = step.preview_path ?? step.image_path;
      const lastPath = this._loadedDisplayPath.get(step.id);
      // Load if not yet cached, OR if the source path changed (e.g. after undo/redo of
      // annotations). In the path-changed case we do NOT clear the old entry first —
      // it remains visible until the new fetch resolves, preventing a blank-frame flicker.
      if (!this.imageCache[displayKey] || lastPath !== displayPath) {
        this._loadedDisplayPath.set(step.id, displayPath);
        const stepId = step.id;
        invoke<string>('get_step_image', { imagePath: displayPath }).then((uri) => {
          this.imageCache[displayKey] = uri;
          // Atomically promote to the stable display URI so the swap is
          // instantaneous and never passes through a blank/placeholder frame.
          this.stepDisplayUri[stepId] = uri;
        }).catch(err => console.error('Failed to load image:', err));
      } else if (!this.stepDisplayUri[step.id]) {
        // Cache hit but stepDisplayUri not yet populated (e.g. first render after
        // component mount). Promote from the existing cache entry immediately so
        // components using stepDisplayUri show the image without a round-trip.
        this.stepDisplayUri[step.id] = this.imageCache[displayKey];
      }

      // Base image (for editor background — only preload if annotations exist,
      // since otherwise display and base are the same).
      if (step.annotations_json) {
        const baseKey = this.baseImageKey(step);
        if (!this.baseImageCache[baseKey]) {
          invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
            this.baseImageCache[baseKey] = uri;
          }).catch(err => console.error('Failed to load base image:', err));
        }
      }

      // Extra monitor images.
      for (let i = 0; i < (step.extra_image_paths?.length ?? 0); i++) {
        const eKey = this.extraImageKey(step.id, i, step.image_version ?? 0);
        if (!this.extraImageCache[eKey]) {
          const path = step.extra_image_paths[i] ?? null;
          if (path !== null) {
            invoke<string>('get_step_image', { imagePath: path }).then((uri) => {
              this.extraImageCache[eKey] = uri;
            }).catch(err => console.error('Failed to load extra image:', err));
          }
        }
      }
    }
  }
}

export const imageStore = new ImageCacheStore();
