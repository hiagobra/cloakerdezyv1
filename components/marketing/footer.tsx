export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 mx-auto w-full max-w-7xl px-6 py-10 md:px-8">
      <div className="divider-soft mb-8" />
      <div className="flex flex-col items-start justify-between gap-4 text-sm text-muted md:flex-row md:items-center">
        <p>
          © {year} Camuflador <span className="text-primary">Zetsu</span>. Suprima sua presença.
        </p>
        <p className="text-xs uppercase tracking-[0.2em] text-muted/70">
          Nen · Cloaking · Camuflagem
        </p>
      </div>
    </footer>
  );
}
