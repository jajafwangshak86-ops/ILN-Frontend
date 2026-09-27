import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * SQL Schema for Reminders:
 *
 * create table reminder_preferences (
 *   address text primary key,
 *   email text not null,
 *   enabled boolean default true,
 *   updated_at timestamptz default now()
 * );
 *
 * create table sent_reminders (
 *   id uuid default gen_random_uuid() primary key,
 *   invoice_id text not null,
 *   milestone int not null,
 *   sent_at timestamptz default now(),
 *   email text not null
 * );
 *
 * create index idx_sent_reminders_invoice_milestone on sent_reminders(invoice_id, milestone);
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazily create a real client only when required. If env vars are missing, export a stub that
// throws on use to avoid runtime import-time errors during Next.js build in CI.
const makeMissingEnvError = () =>
  new Error(
    'Supabase not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required'
  );

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : (new Proxy(
        {},
        {
          get() {
            throw makeMissingEnvError();
          },
          apply() {
            throw makeMissingEnvError();
          },
        }
      ) as unknown as SupabaseClient);

// For client-side use
export { supabase };

// For server-side use (bypasses RLS)
export const getSupabaseAdmin = () => {
  if (!supabaseUrl) {
    console.warn('NEXT_PUBLIC_SUPABASE_URL is missing. Supabase admin client cannot be created.');
    return supabase;
  }
  if (!supabaseServiceKey) {
    console.warn('SUPABASE_SERVICE_ROLE_KEY is missing. Using anon key.');
    return supabase;
  }
  return createClient(supabaseUrl, supabaseServiceKey);
};
