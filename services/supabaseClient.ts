import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://ubqkvuwlojbcqqrxxnsa.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVicWt2dXdsb2piY3Fxcnh4bnNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDYyNDUsImV4cCI6MjA5MTIyMjI0NX0.nPZUO4B-mLap27au3gE7cU6QbVm6NlGTXVKM4skRGAM';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;
