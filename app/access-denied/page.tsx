import { LinkButton } from "@/components/ui/button";

export default function AccessDeniedPage() {
  return (
    <main className="zetsu-bg relative flex min-h-screen items-center justify-center p-6">
      <section className="surface-panel relative z-10 w-full max-w-lg p-10 text-center">
        <span className="text-xs uppercase tracking-[0.22em] text-muted">// 403</span>
        <h1 className="text-display mt-2 text-4xl text-foreground">Acesso restrito</h1>
        <p className="mt-3 text-sm text-muted-strong">
          Sua conta entrou com sucesso, mas não está autorizada para o painel admin.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <LinkButton href="/login" variant="primary" size="md">
            Voltar para login
          </LinkButton>
          <LinkButton href="/dashboard" variant="ghost" size="md">
            Ir para o dashboard
          </LinkButton>
        </div>
      </section>
    </main>
  );
}
