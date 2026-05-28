import { MarketingNavbar } from "@/components/marketing/navbar";
import { MarketingFooter } from "@/components/marketing/footer";
import { LinkButton } from "@/components/ui/button";
import { TextRotator } from "@/components/ui/text-rotator";
import { HeroIntro, FeatureCards, CloakMeter } from "@/components/marketing/landing-motion";

export default function Home() {
  return (
    <div className="zetsu-bg relative min-h-screen flex flex-col">
      <MarketingNavbar />

      <main className="relative z-10 flex-1">
        <section className="mx-auto grid w-full max-w-7xl items-center gap-12 px-6 pt-16 pb-24 md:grid-cols-[1.1fr_1fr] md:px-8 md:pt-24 md:pb-32">
          <HeroIntro>
            <span className="inline-flex items-center gap-2 rounded-full border border-border-soft bg-card-soft/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-primary" />
              Modo Zetsu ativo
            </span>

            <h1 className="text-display text-5xl text-foreground md:text-[68px] lg:text-[80px]">
              Camufle seus<br />criativos no{" "}
              <TextRotator
                words={["TikTok", "Google", "Facebook"]}
                className="font-display"
              />
            </h1>

            <p className="max-w-xl text-base text-muted-strong md:text-lg">
              Suprima a assinatura dos seus vídeos e burle a detecção das plataformas.
              Use Zetsu pra ocultar seus anuncios do algoritmo
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <LinkButton href="/register" variant="primary" size="lg">
                Criar conta
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </LinkButton>
              <LinkButton href="/login" variant="outline" size="lg">
                Entrar
              </LinkButton>
            </div>

            <div className="flex items-center gap-6 pt-6 text-sm text-muted">
              <div className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-primary" />
                Aprovação manual
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-primary" />
                Worker dedicado
              </div>
              <div className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-primary" />
                Multi-plataforma
              </div>
            </div>
          </HeroIntro>

          <div className="relative">
            <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[2.5rem] bg-[radial-gradient(circle_at_center,rgba(168,255,0,0.18),transparent_60%)] blur-2xl" />
            <div className="surface-panel relative overflow-hidden p-3 md:p-4">
              <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-muted backdrop-blur">
                <span className="pulse-dot h-1 w-1 rounded-full bg-primary" />
                cloaking
              </div>
              <video
                autoPlay
                loop
                muted
                playsInline
                preload="auto"
                aria-label="Gon usando Zetsu"
                className="float-soft h-auto w-full rounded-2xl object-cover"
              >
                <source src="/brand/gon.webm" type="video/webm" />
                <source src="/brand/gon.mp4" type="video/mp4" />
              </video>
            </div>
            <CloakMeter />
          </div>
        </section>

        <FeatureCards />
      </main>

      <MarketingFooter />
    </div>
  );
}
