import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True only when both public values are set. Everything account related hides itself otherwise. */
export const supabaseConfigured = Boolean(url && anonKey);

/**
 * Created lazily and only if configured, so an app without accounts never
 * even constructs a client. Used for sign-in and for saving AGGREGATES only.
 * Imports never touch this.
 */
let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  if (!supabaseConfigured) return null;
  client ??= createClient(url!, anonKey!, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true } });
  return client;
}
