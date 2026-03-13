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
   * Cache for primary step images.
   * Key: `${step.id}_v${step.image_version}` → asset URI.
   * The image_version suffix ensures the cache is busted after each image edit.
   */
  imageCache = $state<Record<string, string>>({});
  /** Cache for extra monitor images. Key: `${step.id}_extra_${monitorIndex}_v${ver}` → asset URI. */
  extraImageCache = $state<Record<string, string>>({});

  /** Build the versioned primary image cache key for a step. */
  imageCacheKey(step: Step): string {
    return `${step.id}_v${step.image_version ?? 0}`;
  }

  /** Build the cache key for an extra monitor image. */
  extraImageKey(stepId: number, monitorIndex: number, version = 0): string {
    return `${stepId}_extra_${monitorIndex}_v${version}`;
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
  }

  /** Reset both image caches (call when starting a new recording or navigating back). */
  clearAll() {
    this.imageCache = {};
    this.extraImageCache = {};
  }

  /**
   * Eagerly pre-load images for all steps not yet in either cache.
   * Safe to call on every session-updated event — skips already-cached entries.
   */
  preloadStepImages(steps: Step[]) {
    for (const step of steps) {
      const key = this.imageCacheKey(step);
      if (!this.imageCache[key]) {
        invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
          this.imageCache[key] = uri;
        }).catch(err => console.error('Failed to load image:', err));
      }
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
