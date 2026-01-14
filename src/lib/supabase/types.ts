// Database types for Supabase tables

export interface AvatarLibraryRow {
  gloss_label: string;
  video_url: string;
  category: string;
  metadata: {
    duration_ms: number;
    signer_id: string;
    dialect: string;
  };
  created_at?: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  direction: 'sign_to_audio' | 'audio_to_sign';
  original_text: string | null;
  translated_text: string | null;
  gloss_sequence: string[] | null;
  audio_url: string | null;
  created_at: string;
}

export interface UserRow {
  id: string;
  role: 'deaf' | 'hearing' | 'blind';
  preferences: {
    visual_mode: string;
    voice_id: string;
    high_contrast: boolean;
  };
  created_at: string;
}

// Database schema type for Supabase client
export interface Database {
  public: {
    Tables: {
      avatar_library: {
        Row: AvatarLibraryRow;
        Insert: Omit<AvatarLibraryRow, 'created_at'>;
        Update: Partial<Omit<AvatarLibraryRow, 'gloss_label'>>;
      };
      messages: {
        Row: MessageRow;
        Insert: Omit<MessageRow, 'id' | 'created_at'>;
        Update: Partial<Omit<MessageRow, 'id' | 'created_at'>>;
      };
      users: {
        Row: UserRow;
        Insert: Omit<UserRow, 'created_at'>;
        Update: Partial<Omit<UserRow, 'id' | 'created_at'>>;
      };
    };
  };
}
