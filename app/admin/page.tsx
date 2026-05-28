import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/auth/admin";
import { AdminProfilesPanel, type ProfileRow } from "@/app/admin/profiles-panel";
import { AppHeader } from "@/components/app/app-header";
import { LinkButton } from "@/components/ui/button";

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
    <main className="zetsu-bg relative min-h-screen p-6 md:p-10">
      <section className="relative z-10 mx-auto max-w-6xl">
        <AppHeader
          title="Painel do administrador"
          subtitle="Aprovar ou recusar cadastros antes de liberar acesso ao dashboard."
          actions={
            <LinkButton href="/dashboard" variant="outline" size="sm">
              Ir para o dashboard
            </LinkButton>
          }
        />

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <article className="surface-panel p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Cadastros totais</p>
            <p className="text-display mt-2 text-5xl text-foreground">{rows.length}</p>
          </article>
          <article className="surface-panel p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Pendentes</p>
            <p className="text-display mt-2 text-5xl text-amber-300">{pendingCount}</p>
          </article>
          <article className="surface-panel p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Aprovados</p>
            <p className="text-display mt-2 text-5xl text-primary">{approvedCount}</p>
          </article>
        </section>

        {error ? (
          <p className="surface-panel p-5 text-sm text-red-200">
            Falha ao carregar perfis: {error.message}
          </p>
        ) : (
          <AdminProfilesPanel initialRows={rows} />
        )}
      </section>
    </main>
  );
}
