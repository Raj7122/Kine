import type { AvatarEntry, PlaybackItem } from './types';
import { getAvatarEntryFromDB, isSupabaseConfigured } from '@/lib/supabase';

/**
 * Get avatar entry for a gloss label from Supabase
 */
export async function getAvatarEntryAsync(gloss: string): Promise<AvatarEntry | null> {
  const normalizedGloss = gloss.toUpperCase().replace(/\s+/g, '_');

  if (!isSupabaseConfigured) {
    return null;
  }

  const dbEntry = await getAvatarEntryFromDB(normalizedGloss);
  if (dbEntry) {
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

  return null;
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
 * Preload videos for a sequence
 */
export async function preloadVideos(glossSequence: string[]): Promise<void> {
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
          video.onerror = () => resolve();
        })
    )
  );
}
