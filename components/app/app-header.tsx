import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export function AppHeader({ title, subtitle, actions }: Props) {
  return (
    <header className="surface-panel mb-8 flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
      <Link href="/dashboard" className="flex items-center gap-4 group">
        <Image
          src="/brand/logo-zetsu.png"
          alt="Camuflador Zetsu"
          width={60}
          height={48}
          className="h-12 w-auto object-contain transition-transform group-hover:scale-105"
          unoptimized
        />
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-muted">
            Camuflador <span className="text-primary">Zetsu</span>
          </div>
          <h1 className="text-display text-2xl md:text-[28px] text-foreground">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted">{subtitle}</p>
          ) : null}
        </div>
      </Link>

      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </header>
  );
}
