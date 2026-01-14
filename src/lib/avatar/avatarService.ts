import avatarData from '@/lib/mock-data/avatars.json';
import type { AvatarEntry, AvatarLibrary, PlaybackItem } from './types';
import { USE_MOCK_DATA } from '@/config/constants';
import { getAvatarEntryFromDB, isSupabaseConfigured } from '@/lib/supabase';

// Type assertion for imported JSON (mock data fallback)
const avatarLibrary = avatarData as AvatarLibrary;

/**
 * Get avatar entry for a gloss label (sync version for mock data)
 */
export function getAvatarEntry(gloss: string): AvatarEntry | null {
  const normalizedGloss = gloss.toUpperCase().replace(/\s+/g, '_');
  return avatarLibrary[normalizedGloss] || null;
}

/**
 * Get avatar entry for a gloss label (async version with Supabase)
 */
export async function getAvatarEntryAsync(gloss: string): Promise<AvatarEntry | null> {
  const normalizedGloss = gloss.toUpperCase().replace(/\s+/g, '_');

  // Try Supabase first if configured and not in mock mode
  if (!USE_MOCK_DATA && isSupabaseConfigured) {
    const dbEntry = await getAvatarEntryFromDB(normalizedGloss);
    if (dbEntry) {
      // Convert DB row to AvatarEntry format
      return {
        gloss_label: dbEntry.gloss_label,
        video_url: dbEntry.video_url,
        duration_ms: dbEntry.metadata?.duration_ms || 1000,
        category: dbEntry.category,
        metadata: {
          signer_id: dbEntry.metadata?.signer_id || 'default',
          dialect: dbEntry.metadata?.dialect || 'ASL',
        },
      };
    }
  }

  // Fall back to mock data
  return avatarLibrary[normalizedGloss] || null;
}

/**
 * Check if a gloss exists in the library
 */
export function hasGloss(gloss: string): boolean {
  const normalizedGloss = gloss.toUpperCase().replace(/\s+/g, '_');
  return normalizedGloss in avatarLibrary;
}

/**
 * Get video URL for a gloss
 */
export function getVideoUrl(gloss: string): string | null {
  const entry = getAvatarEntry(gloss);
  return entry?.video_url || null;
}

/**
 * Get duration for a gloss (or fallback duration)
 */
export function getDuration(gloss: string, fallbackMs: number = 1000): number {
  const entry = getAvatarEntry(gloss);
  return entry?.duration_ms || fallbackMs;
}

/**
 * Build playback queue from gloss sequence (sync version)
 */
export function buildPlaybackQueue(glossSequence: string[]): PlaybackItem[] {
  return glossSequence.map((gloss) => {
    const entry = getAvatarEntry(gloss);
    return {
      gloss: gloss.toUpperCase(),
      entry,
      isFallback: entry === null,
    };
  });
}

/**
 * Build playback queue from gloss sequence (async version with Supabase)
 */
export async function buildPlaybackQueueAsync(glossSequence: string[]): Promise<PlaybackItem[]> {
  const items = await Promise.all(
    glossSequence.map(async (gloss) => {
      const entry = await getAvatarEntryAsync(gloss);
      return {
        gloss: gloss.toUpperCase(),
        entry,
        isFallback: entry === null,
      };
    })
  );
  return items;
}

/**
 * Get all available gloss labels
 */
export function getAllGlossLabels(): string[] {
  return Object.keys(avatarLibrary);
}

/**
 * Preload videos for a sequence
 */
export async function preloadVideos(glossSequence: string[]): Promise<void> {
  if (!USE_MOCK_DATA) {
    // Build queue first to get all URLs
    const queue = await buildPlaybackQueueAsync(glossSequence);
    const urls = queue
      .map((item) => item.entry?.video_url)
      .filter((url): url is string => url !== null);

    await Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const video = document.createElement('video');
            video.preload = 'auto';
            video.src = url;
            video.onloadeddata = () => resolve();
            video.onerror = () => resolve(); // Don't fail on error
          })
      )
    );
  }
  // In mock mode, no preloading needed
}
