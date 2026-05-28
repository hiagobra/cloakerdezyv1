"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AppHeader } from "@/components/app/app-header";
import { Button } from "@/components/ui/button";
import { preloadFFmpeg } from "@/lib/camouflage/client/ffmpeg";
import { VideoSection } from "@/components/camouflage/video-section";
import { AudioSection } from "@/components/camouflage/audio-section";
import { ImageSection } from "@/components/camouflage/image-section";
import { MetadataSection } from "@/components/camouflage/metadata-section";

type Tab = "video" | "audio" | "image" | "metadata";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  {
    id: "video",
    label: "Vídeo",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="2" y="5" width="14" height="14" rx="2" />
        <path d="m22 8-6 4 6 4V8z" />
      </svg>
    ),
  },
  {
    id: "audio",
    label: "Áudio",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 11v2" />
      </svg>
    ),
  },
  {
    id: "image",
    label: "Imagem",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.5-3.5L9 20" />
      </svg>
    ),
  },
  {
    id: "metadata",
    label: "Metadados",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 6h18M3 12h18M3 18h12" />
        <circle cx="19" cy="18" r="2" />
      </svg>
    ),
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("video");

  useEffect(() => {
    preloadFFmpeg();
  }, []);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  return (
    <main className="zetsu-bg relative min-h-screen p-4 md:p-8">
      {/* Gon (HxH) no cantinho — bem sutil, dissolvendo no fundo. Só charme. */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 right-0 z-0 hidden h-[60vh] max-h-[600px] w-[50vw] max-w-[640px] bg-cover bg-center opacity-[0.16] md:block"
        style={{
          backgroundImage: "url('/brand/wp6385328.jpg')",
          WebkitMaskImage: "radial-gradient(130% 130% at 100% 100%, #000 18%, transparent 70%)",
          maskImage: "radial-gradient(130% 130% at 100% 100%, #000 18%, transparent 70%)",
        }}
      />

      <section className="relative z-10 mx-auto max-w-5xl">
        <AppHeader
          title="Central de camuflagem"
          subtitle="Suprima a assinatura dos seus criativos — vídeo, áudio, imagem e metadados. Tudo processado no seu navegador."
          actions={
            <Button type="button" onClick={signOut} variant="outline" size="sm">
              Sair
            </Button>
          }
        />

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition ${
                  active ? "text-primary-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                ) : null}
                <span className="relative z-10 flex items-center gap-2">
                  {t.icon}
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active section */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "video" ? <VideoSection /> : null}
            {tab === "audio" ? <AudioSection /> : null}
            {tab === "image" ? <ImageSection /> : null}
            {tab === "metadata" ? <MetadataSection /> : null}
          </motion.div>
        </AnimatePresence>

        <p className="mt-6 text-center text-xs text-muted">
          Nada é enviado pra servidores — a camuflagem acontece 100% no seu navegador. Os arquivos somem ao recarregar a página.
        </p>
      </section>
    </main>
  );
}
