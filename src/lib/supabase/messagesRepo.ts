import { supabase, isSupabaseConfigured } from './client';
import type { MessageRow } from './types';

export interface SaveMessageInput {
  session_id: string;
  direction: 'sign_to_audio' | 'audio_to_sign';
  original_text?: string;
  translated_text?: string;
  gloss_sequence?: string[];
  audio_url?: string;
}

/**
 * Save a message to the database
 */
export async function saveMessage(message: SaveMessageInput): Promise<MessageRow | null> {
  if (!isSupabaseConfigured || !supabase) {
    console.log('[MessagesRepo] Supabase not configured, skipping save');
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .insert([{
        session_id: message.session_id,
        direction: message.direction,
        original_text: message.original_text || null,
        translated_text: message.translated_text || null,
        gloss_sequence: message.gloss_sequence || null,
        audio_url: message.audio_url || null,
      }])
      .select()
      .single();

    if (error) {
      console.error('[MessagesRepo] Save error:', error.message);
      return null;
    }

    console.log('[MessagesRepo] Message saved:', data.id);
    return data;
  } catch (error) {
    console.error('[MessagesRepo] Error saving message:', error);
    return null;
  }
}

/**
 * Get message history for a session
 */
export async function getMessageHistory(sessionId: string): Promise<MessageRow[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[MessagesRepo] History error:', error.message);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[MessagesRepo] Error:', error);
    return [];
  }
}

/**
 * Get recent messages (for history modal)
 */
export async function getRecentMessages(limit: number = 50): Promise<MessageRow[]> {
  if (!isSupabaseConfigured || !supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[MessagesRepo] Recent messages error:', error.message);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[MessagesRepo] Error:', error);
    return [];
  }
}

/**
 * Generate a new session ID
 */
export function generateSessionId(): string {
  return crypto.randomUUID();
}
