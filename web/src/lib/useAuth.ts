import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./supabase";

export interface Auth {
  configured: boolean;
  loading: boolean;
  user: User | null;
  /** A short, user-facing reason sign-in did not work, or null. Never echoes text from the URL or the server. */
  error: string | null;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SIGN_IN_FAILED = "Sign-in did not complete. Check your connection and try again.";

/**
 * When the user cancels on GitHub or the provider fails, Supabase sends them
 * back with `error` / `error_description` in the query string or hash. Detect
 * that so the page can say so instead of silently showing the signed-out state.
 */
function oauthFailedInUrl(): boolean {
  const has = (params: URLSearchParams) => params.has("error") || params.has("error_description");
  return has(new URLSearchParams(window.location.search)) || has(new URLSearchParams(window.location.hash.replace(/^#/, "")));
}

export function useAuth(): Auth {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [error, setError] = useState<string | null>(() => (supabaseConfigured && oauthFailedInUrl() ? SIGN_IN_FAILED : null));

  useEffect(() => {
    const client = supabase();
    if (!client) return;
    let active = true;
    // Whatever went wrong, never leave the page stuck on "Loading...".
    void client.auth
      .getSession()
      .then(({ data }) => {
        if (active) setUser(data.session?.user ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    const { data } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // Drop the error parameters from the address bar once they have been noticed.
  useEffect(() => {
    if (!error || !oauthFailedInUrl()) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [error]);

  const signInWithGitHub = useCallback(async () => {
    const client = supabase();
    if (!client) return;
    setError(null);
    try {
      const { error: e } = await client.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/account` } });
      if (e) setError(SIGN_IN_FAILED);
    } catch {
      setError(SIGN_IN_FAILED);
    }
  }, []);
  const signOut = useCallback(async () => {
    try {
      await supabase()?.auth.signOut();
    } catch {
      // The local session is cleared either way; a failed server call is not worth alarming the user.
    }
  }, []);

  return { configured: supabaseConfigured, loading, user, error, signInWithGitHub, signOut };
}
