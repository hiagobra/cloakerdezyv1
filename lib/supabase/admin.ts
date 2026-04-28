import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";

let cachedAdmin: SupabaseClient | null = null;

export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Configure a Service Role Key no .env.local e nas envs da Vercel.",
    );
  }
  return key;
}

export function createAdminClient(): SupabaseClient {
  if (cachedAdmin) {
    return cachedAdmin;
  }

  const { url } = getSupabaseEnv();
  const serviceKey = getServiceRoleKey();

  cachedAdmin = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdmin;
}
