import type { SupabaseClient, User } from "@supabase/supabase-js";

type PersistProfileInput = {
  fallbackEmail: string;
  phone?: string;
};

export async function persistProfile(
  supabase: SupabaseClient,
  user: User | null,
  input: PersistProfileInput,
) {
  if (!user) {
    return;
  }

  await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? input.fallbackEmail,
      phone: input.phone,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}
