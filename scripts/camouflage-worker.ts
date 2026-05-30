/**
 * Worker dedicado da fila de camuflagem server-side.
 *
 * Loop: claim_camouflage_job() (atomico) -> roda o pipeline Python conforme
 * kind+mode -> parseia progresso do stdout -> grava output no disco -> marca
 * done/error -> registra metrica em camouflage_logs. Concorrencia 1 (v1).
 *
 * Roda via tsx sob PM2 (script `worker:camouflage`). Cria o proprio client
 * service-role: NAO importa lib/supabase/admin.ts (que usa "server-only" e
 * quebraria fora do bundler do Next).
 *
 * Envs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *       CAMOUFLAGE_STORAGE_DIR, AUDIO_POC_DIR, AUDIO_POC_PYTHON.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getJobDir, safeExtension, fileExists, cleanupExpired } from "../lib/camouflage/server/storage";

const POLL_INTERVAL_MS = 3000;
const CLEANUP_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CLEANUP_EVERY_IDLE = 60; // a cada ~60 ciclos ociosos (~3min)

interface JobRecord {
  id: string;
  user_id: string;
  kind: "audio" | "video" | "filter";
  mode: "fast" | "max";
  target_preset: string | null;
  input_path: string;
  input_name: string;
  cover_path: string | null;
}

function loadDotEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(path.resolve(process.cwd(), file), "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const key = m[1];
        if (process.env[key] !== undefined) continue;
        let value = m[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    } catch {
      /* arquivo opcional */
    }
  }
}

function makeAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltam envs NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY para o worker.",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sanitizeBase(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60);
  return cleaned || "midia";
}

/** Resolve o caminho/nome de saida conforme o tipo. Video sempre vira .mp4. */
function resolveOutput(job: JobRecord): { outputPath: string; outputName: string } {
  const dir = getJobDir(job.id);
  if (job.kind === "video" || job.kind === "filter") {
    return {
      outputPath: path.join(dir, "output.mp4"),
      outputName: `camuflado_${sanitizeBase(job.input_name)}.mp4`,
    };
  }
  const ext = safeExtension(job.input_name, ".mp3");
  return {
    outputPath: path.join(dir, `output${ext}`),
    outputName: `camuflado_${sanitizeBase(job.input_name)}${ext}`,
  };
}

function buildPythonArgs(job: JobRecord, outputPath: string): string[] {
  const preset = job.target_preset || "financas_pt";

  // Filtros: "desmarca" o criativo (filtro imperceptivel + frame inicial
  // opcional). Nao mexe no audio (so re-encode quando ha intro).
  if (job.kind === "filter") {
    const args = [
      "-m", "audio_poc.cli", "desmark",
      "--input", job.input_path,
      "--output", outputPath,
    ];
    if (job.cover_path) args.push("--cover", job.cover_path);
    return args;
  }

  // Maximo (audio OU video): phase-cancel. Remove as palavras reais do downmix
  // mono que toda ASR (AssemblyAI/Whisper/Gemini) usa. CPU, sem torch.
  if (job.mode === "max") {
    return [
      "-m", "audio_poc.cli", "cloak-phase",
      "--input", job.input_path,
      "--output", outputPath,
      "--target-preset", preset,
    ];
  }

  // Rapido: pipeline "viés de tópico" (mono-compativel, funciona em qualquer device).
  if (job.kind === "video") {
    return [
      "-m", "audio_poc.cli", "cloak",
      "--input", job.input_path,
      "--output", outputPath,
      "--target-preset", preset,
      "--profile", "standard",
    ];
  }
  return [
    "-m", "audio_poc.cli", "cloak-audio",
    "--input", job.input_path,
    "--output", outputPath,
    "--target-preset", preset,
    "--mode", "fast",
  ];
}

async function updateJob(
  admin: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from("camouflage_jobs").update(patch).eq("id", id);
  if (error) console.error(`[worker] falha ao atualizar job ${id}:`, error.message);
}

/** Roda o python, faz stream do progresso e resolve sucesso/erro. */
function runPython(
  job: JobRecord,
  outputPath: string,
  onProgress: (pct: number, msg: string) => void,
): Promise<{ ok: boolean; stderrTail: string }> {
  const python = process.env.AUDIO_POC_PYTHON || "python";
  const audioPocDir = path.resolve(process.env.AUDIO_POC_DIR || "audio-encryption-poc");
  const args = buildPythonArgs(job, outputPath);

  return new Promise((resolve) => {
    const child = spawn(python, args, {
      cwd: audioPocDir,
      env: { ...process.env, PYTHONPATH: path.join(audioPocDir, "src"), PYTHONUNBUFFERED: "1" },
    });

    let stderrBuf = "";
    let stdoutCarry = "";

    // Progresso coarse pra video (cloak nao emite PROGRESS); audio/filter usam linhas.
    if (job.kind === "video") onProgress(15, "processando video...");

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutCarry += chunk.toString();
      const lines = stdoutCarry.split(/\r?\n/);
      stdoutCarry = lines.pop() ?? "";
      for (const line of lines) {
        const m = line.match(/^PROGRESS\s+(\d+)\s+(.*)$/);
        if (m) onProgress(Math.min(99, parseInt(m[1], 10)), m[2].trim());
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
    });

    child.on("error", (err) => {
      resolve({ ok: false, stderrTail: `spawn falhou: ${err.message}` });
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, stderrTail: stderrBuf.slice(-1500) });
    });
  });
}

async function processJob(admin: SupabaseClient, job: JobRecord): Promise<void> {
  console.log(`[worker] job ${job.id} kind=${job.kind} mode=${job.mode} preset=${job.target_preset}`);
  const { outputPath, outputName } = resolveOutput(job);

  let lastPct = 0;
  let lastUpdate = 0;
  const onProgress = (pct: number, msg: string) => {
    const now = Date.now();
    if (pct === lastPct && now - lastUpdate < 1500) return;
    lastPct = pct;
    lastUpdate = now;
    void updateJob(admin, job.id, { progress: pct, message: msg.slice(0, 300) });
  };

  const { ok, stderrTail } = await runPython(job, outputPath, onProgress);

  if (!ok || !(await fileExists(outputPath))) {
    await updateJob(admin, job.id, {
      status: "error",
      error: (stderrTail || "Pipeline falhou sem saida.").slice(0, 1500),
      finished_at: new Date().toISOString(),
    });
    console.error(`[worker] job ${job.id} ERRO`);
    return;
  }

  await updateJob(admin, job.id, {
    status: "done",
    progress: 100,
    message: "Concluido",
    output_path: outputPath,
    output_name: outputName,
    finished_at: new Date().toISOString(),
  });

  // Metrica (best-effort): alimenta o total do painel admin.
  await admin.from("camouflage_logs").insert({ user_id: job.user_id, type: job.kind });
  console.log(`[worker] job ${job.id} OK -> ${outputName}`);
}

async function main(): Promise<void> {
  loadDotEnv();
  const admin = makeAdminClient();
  console.log("[worker] iniciado. Aguardando jobs...");

  let idleCycles = 0;
  for (;;) {
    const { data, error } = await admin.rpc("claim_camouflage_job");
    if (error) {
      console.error("[worker] claim falhou:", error.message);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const job = (data as JobRecord | null) ?? null;
    if (!job || !job.id) {
      idleCycles++;
      if (idleCycles % CLEANUP_EVERY_IDLE === 0) {
        const removed = await cleanupExpired(CLEANUP_TTL_MS);
        if (removed > 0) console.log(`[worker] cleanup removeu ${removed} job(s) antigos.`);
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    idleCycles = 0;
    try {
      await processJob(admin, job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] excecao no job ${job.id}:`, message);
      await updateJob(admin, job.id, {
        status: "error",
        error: message.slice(0, 1500),
        finished_at: new Date().toISOString(),
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
