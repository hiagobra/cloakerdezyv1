import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin";
import { AdminProfilesPanel, type ProfileRow } from "@/app/admin/profiles-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (!isAdminEmail(user.email)) {
    redirect("/access-denied");
  }

  const admin = createAdminClient();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, email, phone, status, created_at, approved_at, last_seen_at")
    .order("created_at", { ascending: false });

  const rows: ProfileRow[] = (profiles ?? []).map((profile) => ({
    id: profile.id,
    email: profile.email ?? "",
    phone: profile.phone ?? "",
    status: profile.status ?? "pending",
    createdAt: profile.created_at,
    approvedAt: profile.approved_at,
    lastSeenAt: profile.last_seen_at,
  }));

  const pendingCount = rows.filter((row) => row.status === "pending").length;
  const approvedCount = rows.filter((row) => row.status === "approved").length;

  return (
    <main className="dezy-bg min-h-screen p-6 md:p-10">
      <section className="mx-auto max-w-6xl">
        <header className="glass-panel mb-8 flex flex-col gap-4 rounded-3xl p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Image
              src="/brand/logo.png"
              alt="CloakerDezy"
              width={56}
              height={56}
              className="rounded-full border border-[rgba(157,107,255,0.45)]"
            />
            <div>
              <h1 className="text-2xl font-semibold">Painel do administrador</h1>
              <p className="text-sm text-muted">
                Aprovar ou recusar cadastros antes de liberar acesso ao dashboard.
              </p>
            </div>
          </div>

          <Link
            href="/dashboard"
            className="rounded-xl border border-primary/70 px-4 py-2 text-sm font-semibold transition hover:bg-primary/15"
          >
            Ir para o dashboard
          </Link>
        </header>

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <article className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-muted">Cadastros totais</p>
            <p className="mt-2 text-4xl font-semibold text-primary">{rows.length}</p>
          </article>
          <article className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-muted">Pendentes</p>
            <p className="mt-2 text-4xl font-semibold text-amber-200">{pendingCount}</p>
          </article>
          <article className="glass-panel rounded-2xl p-5">
            <p className="text-sm text-muted">Aprovados</p>
            <p className="mt-2 text-4xl font-semibold text-emerald-200">{approvedCount}</p>
          </article>
        </section>

        {error ? (
          <p className="glass-panel rounded-2xl p-5 text-sm text-red-200">
            Falha ao carregar perfis: {error.message}
          </p>
        ) : (
          <AdminProfilesPanel initialRows={rows} />
        )}
      </section>
    </main>
  );
}
