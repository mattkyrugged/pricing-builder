import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://dvmdzhylxudswcsvhjnz.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2bWR6aHlseHVkc3djc3Zoam56Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMTMxNTEsImV4cCI6MjA4NzY4OTE1MX0.-pl-gxtDtRncVDrBAG9yu7BpkMthzgjziYvZV3rvDhw';

export const supabase = createClient(supabaseUrl, supabaseKey);
