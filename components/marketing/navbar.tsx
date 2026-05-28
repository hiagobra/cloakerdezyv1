import Image from "next/image";
import Link from "next/link";
import { LinkButton } from "@/components/ui/button";

export function MarketingNavbar() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5 md:px-8">
      <Link href="/" className="flex items-center gap-2.5 group">
        <Image
          src="/brand/logo-zetsu.png"
          alt="Camuflador Zetsu"
          width={46}
          height={36}
          className="h-9 w-auto object-contain transition-transform group-hover:scale-105"
          priority
          unoptimized
        />
        <span className="text-display-tight text-lg text-foreground">
          Camuflador <span className="text-primary">Zetsu</span>
        </span>
      </Link>

      <nav className="flex items-center gap-2 md:gap-3">
        <LinkButton href="/login" variant="ghost" size="sm">
          Entrar
        </LinkButton>
        <LinkButton href="/register" variant="primary" size="sm">
          Criar conta
        </LinkButton>
      </nav>
    </header>
  );
}
