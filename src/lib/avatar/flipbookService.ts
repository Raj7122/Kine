/**
 * Flipbook Service - Handles loading and caching of flipbook frames
 */

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { FlipbookEntry } from './types';
import { DEFAULT_FPS } from './types';

// Frame cache - stores preloaded Image objects
const frameCache = new Map<string, HTMLImageElement[]>();

// Flipbook metadata cache
const flipbookCache = new Map<string, FlipbookEntry>();

// Supabase Storage bucket name
const STORAGE_BUCKET = 'avatars';

/**
 * Get the public URL for a frame in Supabase Storage
 */
export function getFrameUrl(storagePath: string, frameNumber: number): string {
  if (!isSupabaseConfigured || !supabase) {
    // Fallback to local path for development
    return `/frames/${storagePath}/${String(frameNumber).padStart(4, '0')}.webp`;
  }

  // Remove bucket prefix if present (e.g., "avatars/HELLO" -> "HELLO")
  const pathInBucket = storagePath.replace(/^avatars\//, '');

  const { data } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(`${pathInBucket}/${String(frameNumber).padStart(4, '0')}.webp`);

  return data.publicUrl;
}

/**
 * Generate all frame URLs for a flipbook entry
 */
export function generateFrameUrls(storagePath: string, frameCount: number): string[] {
  const urls: string[] = [];
  for (let i = 1; i <= frameCount; i++) {
    urls.push(getFrameUrl(storagePath, i));
  }
  return urls;
}

/**
 * Get flipbook metadata from database
 */
export async function getFlipbookEntry(gloss: string): Promise<FlipbookEntry | null> {
  const normalizedGloss = gloss.toUpperCase().replace(/\s+/g, '_');

  // Check cache first
  if (flipbookCache.has(normalizedGloss)) {
    return flipbookCache.get(normalizedGloss)!;
  }

  if (!isSupabaseConfigured || !supabase) {
    console.log('[Flipbook] Supabase not configured, using mock data');
    return getMockFlipbookEntry(normalizedGloss);
  }

  try {
    const { data, error } = await supabase
      .from('avatar_library')
      .select('gloss_label, frame_count, fps, storage_path, metadata')
      .eq('gloss_label', normalizedGloss)
      .maybeSingle(); // Use maybeSingle to avoid 406 error when no row found

    if (error) {
      console.log(`[Flipbook] Error fetching ${normalizedGloss}:`, error.message);
      return null;
    }

    if (!data || !data.frame_count) {
      console.log(`[Flipbook] No flipbook data for ${normalizedGloss}`);
      return null;
    }

    const entry: FlipbookEntry = {
      gloss: data.gloss_label,
      frameCount: data.frame_count,
      fps: data.fps || DEFAULT_FPS,
      storagePath: data.storage_path || `avatars/${normalizedGloss}`,
      frameUrls: generateFrameUrls(
        data.storage_path || normalizedGloss,
        data.frame_count
      ),
      durationMs: Math.round((data.frame_count / (data.fps || DEFAULT_FPS)) * 1000),
    };

    flipbookCache.set(normalizedGloss, entry);
    return entry;

  } catch (err) {
    console.error('[Flipbook] Error fetching entry:', err);
    return null;
  }
}

/**
 * Mock flipbook entry for development
 */
function getMockFlipbookEntry(gloss: string): FlipbookEntry | null {
  // For development, return a mock entry
  // In production, this would be replaced with real data
  const mockFrameCount = 36; // 1.5 seconds at 24fps

  return {
    gloss,
    frameCount: mockFrameCount,
    fps: DEFAULT_FPS,
    storagePath: `avatars/${gloss}`,
    frameUrls: generateFrameUrls(gloss, mockFrameCount),
    durationMs: Math.round((mockFrameCount / DEFAULT_FPS) * 1000),
  };
}

/**
 * Preload all frames for a flipbook entry
 * Returns a promise that resolves when all frames are loaded
 */
export async function preloadFlipbook(
  entry: FlipbookEntry,
  onProgress?: (loaded: number, total: number) => void
): Promise<HTMLImageElement[]> {
  const cacheKey = entry.gloss;

  // Check if already cached
  if (frameCache.has(cacheKey)) {
    return frameCache.get(cacheKey)!;
  }

  const images: HTMLImageElement[] = [];
  let loadedCount = 0;

  const loadPromises = entry.frameUrls.map((url, index) => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        loadedCount++;
        onProgress?.(loadedCount, entry.frameCount);
        resolve(img);
      };

      img.onerror = () => {
        console.warn(`[Flipbook] Failed to load frame ${index + 1}: ${url}`);
        // Resolve with a placeholder instead of rejecting
        loadedCount++;
        onProgress?.(loadedCount, entry.frameCount);
        resolve(img); // Still resolve to not break the chain
      };

      img.src = url;
    });
  });

  try {
    const loadedImages = await Promise.all(loadPromises);
    frameCache.set(cacheKey, loadedImages);
    return loadedImages;
  } catch (err) {
    console.error('[Flipbook] Preload error:', err);
    return [];
  }
}

/**
 * Get cached frames for a gloss
 */
export function getCachedFrames(gloss: string): HTMLImageElement[] | null {
  const normalizedGloss = gloss.toUpperCase().replace(/\s+/g, '_');
  return frameCache.get(normalizedGloss) || null;
}

/**
 * Check if a gloss has flipbook data
 */
export async function hasFlipbook(gloss: string): Promise<boolean> {
  const entry = await getFlipbookEntry(gloss);
  return entry !== null && entry.frameCount > 0;
}

/**
 * Preload frames for multiple glosses (for queue lookahead)
 */
export async function preloadFlipbooks(
  glosses: string[],
  maxConcurrent: number = 2
): Promise<void> {
  // Load in batches to avoid overwhelming the browser
  for (let i = 0; i < glosses.length; i += maxConcurrent) {
    const batch = glosses.slice(i, i + maxConcurrent);
    const entries = await Promise.all(batch.map(getFlipbookEntry));

    await Promise.all(
      entries
        .filter((e): e is FlipbookEntry => e !== null)
        .map(entry => preloadFlipbook(entry))
    );
  }
}

/**
 * Clear frame cache (useful for memory management)
 */
export function clearFrameCache(gloss?: string): void {
  if (gloss) {
    const normalizedGloss = gloss.toUpperCase().replace(/\s+/g, '_');
    frameCache.delete(normalizedGloss);
  } else {
    frameCache.clear();
  }
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  frameCache.clear();
  flipbookCache.clear();
}
