"use client";

import { motion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

const FEATURES = [
  {
    title: "Uso Gratuito",
    desc: "Cadastre-se com seus dados e espere um administrador aprovar seu acesso, utilize a plataforma com zero custos",
    glyph: "01",
  },
  {
    title: "Multi-plataforma",
    desc: "TikTok, Google Ads e Facebook. O mesmo vídeo, várias assinaturas únicas.",
    glyph: "02",
  },
  {
    title: "Processamento rápido",
    desc: "Worker dedicado, fila em tempo real. Faz upload e acompanha o status.",
    glyph: "03",
  },
];

const ease = [0.22, 1, 0.36, 1] as const;

export function HeroIntro({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: { staggerChildren: 0.08, delayChildren: 0.05 },
        },
      }}
      className="flex flex-col gap-6"
    >
      {Array.isArray(children)
        ? children.map((child, idx) => (
            <motion.div
              key={idx}
              variants={{
                hidden: { opacity: 0, y: 14 },
                show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } },
              }}
            >
              {child}
            </motion.div>
          ))
        : (
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 14 },
              show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } },
            }}
          >
            {children}
          </motion.div>
        )}
    </motion.div>
  );
}

export function CloakMeter() {
  const [detectavel, setDetectavel] = useState(100);
  const [zetsu, setZetsu] = useState(0);

  useEffect(() => {
    const initialDelay = 2000;
    const duration = 3600;
    const holdEnd = 1800;
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const runCycle = () => {
      timeout = setTimeout(() => {
        if (cancelled) return;

        const start = performance.now();

        const tick = (now: number) => {
          if (cancelled) return;

          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);

          setDetectavel(Math.round(100 - eased * 100));
          setZetsu(Math.round(eased * 100));

          if (progress < 1) {
            raf = requestAnimationFrame(tick);
            return;
          }

          timeout = setTimeout(() => {
            if (cancelled) return;
            setDetectavel(100);
            setZetsu(0);
            runCycle();
          }, holdEnd);
        };

        raf = requestAnimationFrame(tick);
      }, initialDelay);
    };

    runCycle();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="mt-3 flex items-end justify-between gap-4 px-2">
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-xs text-muted">
          <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-muted/80" />
          Detectável{" "}
          <span className="tabular-nums text-muted-strong">{detectavel}%</span>
        </span>
        <div className="mt-1.5 h-0.5 max-w-[120px] overflow-hidden rounded-full bg-border-soft">
          <div
            className="h-full rounded-full bg-muted/60"
            style={{ width: `${detectavel}%` }}
          />
        </div>
      </div>

      <div className="shrink-0 text-right">
        <span className="inline-flex rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-primary">
          Zetsu <span className="tabular-nums">{zetsu}%</span>
        </span>
        <div className="mt-1.5 ml-auto h-0.5 w-[72px] overflow-hidden rounded-full bg-border-soft">
          <div
            className="ml-auto h-full rounded-full bg-primary/80"
            style={{ width: `${zetsu}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function FeatureCards() {
  return (
    <section className="mx-auto w-full max-w-7xl px-6 pb-24 md:px-8">
      <div className="mb-10 flex items-end justify-between">
        <h2 className="text-display text-3xl text-foreground md:text-[40px]">
          Três princípios.<br />
          <span className="text-muted">Zero assinatura.</span>
        </h2>
        <span className="hidden text-xs uppercase tracking-[0.22em] text-muted md:block">
          /// como funciona
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {FEATURES.map((feature, idx) => (
          <motion.article
            key={feature.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.55, ease, delay: idx * 0.08 }}
            className="surface-panel group relative overflow-hidden p-6 transition-colors hover:border-primary/40"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted">
                {feature.glyph}
              </span>
              <span className="h-2 w-2 rounded-full bg-primary opacity-60 transition-opacity group-hover:opacity-100" />
            </div>
            <h3 className="text-display-tight text-xl text-foreground">
              {feature.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-strong">
              {feature.desc}
            </p>
            <div className="pointer-events-none absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-primary/10 blur-3xl opacity-0 transition-opacity group-hover:opacity-100" />
          </motion.article>
        ))}
      </div>
    </section>
  );
}
