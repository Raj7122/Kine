// Database types for Supabase tables - matches ERD.md

export interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'deaf' | 'hard_of_hearing' | 'hearing' | 'blind';
  preferences: {
    visual_mode: 'text_only' | 'text_plus_avatar';
    voice_id: string;
    text_size: 'small' | 'medium' | 'large';
    high_contrast: boolean;
  };
  created_at: string;
  last_active: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  start_time: string;
  end_time: string | null;
  title: string | null;
  created_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  direction: 'sign_to_audio' | 'audio_to_sign';
  original_input_path: string | null;
  original_text: string | null;
  translated_text: string | null;
  gloss_sequence: string[] | null;
  audio_url: string | null;
  created_at: string;
}

export interface AvatarLibraryRow {
  id: string;
  gloss_label: string;
  video_url: string;
  category: string;
  difficulty_level: number;
  metadata: {
    duration_ms: number;
    signer_id: string;
    dialect: string;
    hand?: 'left' | 'right' | 'both';
  };
  created_at?: string;
}

export interface SavedPhraseRow {
  id: string;
  user_id: string;
  label: string;
  content: string;
  display_order: number;
  is_favorite: boolean;
  created_at: string;
}

export interface FeedbackRow {
  id: string;
  message_id: string;
  user_id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comments: string | null;
  is_resolved: boolean;
  created_at: string;
}

// Database schema type for Supabase client
export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        Insert: Omit<UserRow, 'created_at' | 'last_active'> & {
          created_at?: string;
          last_active?: string;
        };
        Update: Partial<Omit<UserRow, 'id' | 'created_at'>>;
      };
      sessions: {
        Row: SessionRow;
        Insert: Omit<SessionRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<SessionRow, 'id' | 'created_at'>>;
      };
      messages: {
        Row: MessageRow;
        Insert: Omit<MessageRow, 'id' | 'created_at'>;
        Update: Partial<Omit<MessageRow, 'id' | 'created_at'>>;
      };
      avatar_library: {
        Row: AvatarLibraryRow;
        Insert: Omit<AvatarLibraryRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<AvatarLibraryRow, 'gloss_label'>>;
      };
      saved_phrases: {
        Row: SavedPhraseRow;
        Insert: Omit<SavedPhraseRow, 'id' | 'created_at'>;
        Update: Partial<Omit<SavedPhraseRow, 'id' | 'created_at'>>;
      };
      feedback: {
        Row: FeedbackRow;
        Insert: Omit<FeedbackRow, 'id' | 'created_at'>;
        Update: Partial<Omit<FeedbackRow, 'id' | 'created_at'>>;
      };
    };
  };
}

// Re-export for convenience
export type User = UserRow;
export type Session = SessionRow;
export type Message = MessageRow;
export type AvatarLibraryEntry = AvatarLibraryRow;
export type SavedPhrase = SavedPhraseRow;
export type Feedback = FeedbackRow;
