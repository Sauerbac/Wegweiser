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

  /** Remove all cache entries for a given step ID (all versions). */
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
  }

  /** Reset all image caches (call when starting a new recording or navigating back). */
  clearAll() {
    this.imageCache = {};
    this.extraImageCache = {};
    this.baseImageCache = {};
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
      if (!this.imageCache[displayKey]) {
        const displayPath = step.preview_path ?? step.image_path;
        invoke<string>('get_step_image', { imagePath: displayPath }).then((uri) => {
          this.imageCache[displayKey] = uri;
        }).catch(err => console.error('Failed to load image:', err));
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
