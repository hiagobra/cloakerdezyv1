"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function RegisterPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <main className="zetsu-bg relative flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image
            src="/brand/logo-zetsu.png"
            alt="Camuflador Zetsu"
            width={40}
            height={32}
            className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
            priority
            unoptimized
          />
          <span className="text-display-tight text-base text-foreground">
            Camuflador <span className="text-primary">Zetsu</span>
          </span>
        </Link>
        <Link href="/login" className="text-sm text-muted hover:text-foreground transition-colors">
          Ja tem conta? Entrar →
        </Link>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16">
        <section className="surface-panel w-full max-w-md p-8 md:p-10">
          <div className="mb-8 flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.22em] text-muted">// cadastro</span>
            <h1 className="text-display text-3xl text-foreground">Criar conta</h1>
            <p className="text-sm text-muted-strong">
              Cadastre email, senha e telefone. Sua conta passa por aprovacao manual antes de liberar acesso.
            </p>
          </div>

          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const formEl = event.currentTarget;
              const form = new FormData(formEl);
              const email = String(form.get("email") ?? "");
              const password = String(form.get("password") ?? "");
              const phone = String(form.get("phone") ?? "");

              setLoading(true);
              setError("");
              setMessage("");

              try {
                const response = await fetch("/api/auth/register", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email, password, phone }),
                });

                const data = (await response.json().catch(() => ({}))) as {
                  error?: string;
                  message?: string;
                };

                if (!response.ok) {
                  setError(data.error ?? "Nao foi possivel cadastrar.");
                  return;
                }

                setMessage(
                  data.message ??
                    "Cadastro recebido. Voce podera entrar assim que o administrador aprovar.",
                );
                formEl.reset();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Erro inesperado.");
              } finally {
                setLoading(false);
              }
            }}
          >
            <div className="space-y-1.5">
              <label className="block text-xs uppercase tracking-[0.18em] text-muted" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="voce@exemplo.com"
                className="w-full rounded-xl border border-border-soft bg-card-soft px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:bg-card placeholder:text-muted/60"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs uppercase tracking-[0.18em] text-muted" htmlFor="password">
                Senha <span className="normal-case text-muted/70">(min. 8 caracteres)</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                minLength={8}
                className="w-full rounded-xl border border-border-soft bg-card-soft px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:bg-card placeholder:text-muted/60"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs uppercase tracking-[0.18em] text-muted" htmlFor="phone">
                Telefone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                placeholder="+5511999999999"
                className="w-full rounded-xl border border-border-soft bg-card-soft px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:bg-card placeholder:text-muted/60"
                required
              />
            </div>
            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? "Cadastrando..." : "Cadastrar"}
            </Button>
          </form>

          <div className="divider-soft my-6" />

          <p className="text-center text-sm text-muted">
            Ja tem conta?{" "}
            <Link href="/login" className="text-primary hover:text-primary-strong underline-offset-4 hover:underline">
              Entrar
            </Link>
          </p>

          {error ? (
            <p className="mt-5 rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          {message ? (
            <p className="mt-5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
              {message}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
