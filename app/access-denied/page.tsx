import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="dezy-bg flex min-h-screen items-center justify-center p-6">
      <section className="glass-panel w-full max-w-lg rounded-3xl p-8 text-center">
        <h1 className="text-3xl font-semibold">Acesso restrito</h1>
        <p className="mt-3 text-sm text-muted">
          Sua conta entrou com sucesso, mas nao esta autorizada para o painel admin.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-xl bg-primary px-4 py-2 font-semibold text-[#100b23] transition hover:bg-primary-strong"
          >
            Voltar para login
          </Link>
        </div>
      </section>
    </main>
  );
}
