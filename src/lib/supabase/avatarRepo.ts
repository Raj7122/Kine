import { supabase, isSupabaseConfigured } from './client';
import type { AvatarLibraryRow } from './types';

// In-memory cache for avatar entries
const avatarCache = new Map<string, AvatarLibraryRow | null>();
let fullLibraryCache: AvatarLibraryRow[] | null = null;

/**
 * Get a single avatar entry by gloss label
 */
export async function getAvatarEntryFromDB(
  gloss: string
): Promise<AvatarLibraryRow | null> {
  const normalizedGloss = gloss.toUpperCase();

  // Check cache first
  if (avatarCache.has(normalizedGloss)) {
    return avatarCache.get(normalizedGloss) || null;
  }

  // If Supabase not configured, return null (caller will use mock)
  if (!isSupabaseConfigured || !supabase) {
    console.log('[AvatarRepo] Supabase not configured, skipping DB query');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('avatar_library')
      .select('*')
      .eq('gloss_label', normalizedGloss)
      .single();

    if (error) {
      console.warn('[AvatarRepo] Query error:', error.message);
      avatarCache.set(normalizedGloss, null);
      return null;
    }

    // Cache the result
    avatarCache.set(normalizedGloss, data);
    return data;
  } catch (error) {
    console.error('[AvatarRepo] Error fetching avatar:', error);
    return null;
  }
}

/**
 * Get all avatar entries (for preloading)
 */
export async function getAllAvatarsFromDB(): Promise<AvatarLibraryRow[]> {
  // Return cached full library if available
  if (fullLibraryCache) {
    return fullLibraryCache;
  }

  // If Supabase not configured, return empty array
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('avatar_library')
      .select('*')
      .order('gloss_label');

    if (error) {
      console.warn('[AvatarRepo] Error fetching all avatars:', error.message);
      return [];
    }

    // Cache the results
    const avatars = (data || []) as AvatarLibraryRow[];
    fullLibraryCache = avatars;
    avatars.forEach((avatar) => {
      avatarCache.set(avatar.gloss_label, avatar);
    });

    return fullLibraryCache;
  } catch (error) {
    console.error('[AvatarRepo] Error:', error);
    return [];
  }
}

/**
 * Get avatars by category
 */
export async function getAvatarsByCategory(
  category: string
): Promise<AvatarLibraryRow[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('avatar_library')
      .select('*')
      .eq('category', category)
      .order('gloss_label');

    if (error) {
      console.warn('[AvatarRepo] Category query error:', error.message);
      return [];
    }

    return (data || []) as AvatarLibraryRow[];
  } catch (error) {
    console.error('[AvatarRepo] Error:', error);
    return [];
  }
}

/**
 * Clear the cache (useful for testing or refresh)
 */
export function clearAvatarCache(): void {
  avatarCache.clear();
  fullLibraryCache = null;
}
