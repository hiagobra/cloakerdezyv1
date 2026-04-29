import { createClient } from "@/lib/supabase/server";
import { deleteJobsByUser } from "@/lib/camouflage/job-store";

async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST() {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const removed = await deleteJobsByUser(userId);
  return Response.json({ ok: true, removed });
}
