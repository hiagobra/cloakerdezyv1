"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <main className="dezy-bg flex min-h-screen items-center justify-center p-6">
      <section className="glass-panel w-full max-w-md rounded-3xl p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image
            src="/brand/logo.png"
            alt="CloakerDezy"
            width={74}
            height={74}
            className="rounded-full border border-[rgba(157,107,255,0.45)]"
            priority
          />
          <h1 className="text-2xl font-semibold">Entrar na CloakerDezy</h1>
          <p className="text-sm text-muted">Use seu email e senha cadastrados.</p>
        </div>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const email = String(form.get("email") ?? "");
            const password = String(form.get("password") ?? "");

            setLoading(true);
            setError("");

            try {
              const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
              });

              const data = (await response.json().catch(() => ({}))) as {
                error?: string;
                role?: "admin" | "user";
              };

              if (!response.ok) {
                setError(data.error ?? "Nao foi possivel entrar.");
                return;
              }

              router.push(data.role === "admin" ? "/admin" : "/dashboard");
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Erro inesperado.");
            } finally {
              setLoading(false);
            }
          }}
        >
          <label className="block text-sm text-muted" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="voce@exemplo.com"
            className="w-full rounded-xl border border-border-soft bg-card-soft px-4 py-3 text-sm outline-none transition focus:border-primary"
            required
          />
          <label className="block text-sm text-muted" htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Sua senha"
            className="w-full rounded-xl border border-border-soft bg-card-soft px-4 py-3 text-sm outline-none transition focus:border-primary"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-[#100b23] transition hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          Nao tem conta?{" "}
          <Link href="/register" className="text-primary underline decoration-primary/50 underline-offset-4">
            Criar conta
          </Link>
        </p>

        {error ? (
          <p className="mt-5 rounded-xl border border-red-400/40 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
