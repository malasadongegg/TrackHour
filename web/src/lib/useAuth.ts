import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./supabase";

export interface Auth {
  configured: boolean;
  loading: boolean;
  user: User | null;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): Auth {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    const client = supabase();
    if (!client) return;
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signInWithGitHub = useCallback(async () => {
    await supabase()?.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/account` } });
  }, []);
  const signOut = useCallback(async () => {
    await supabase()?.auth.signOut();
  }, []);

  return { configured: supabaseConfigured, loading, user, signInWithGitHub, signOut };
}
