import { mkdir, writeFile, readFile, rm, stat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Storage em disco para os jobs de camuflagem server-side. Tanto a API do
 * Next quanto o worker (tsx, processo separado) compartilham este modulo, por
 * isso ele e Node puro (sem "server-only" / sem deps de Next). Os arquivos
 * ficam em CAMOUFLAGE_STORAGE_DIR/<jobId>/{input,output}.<ext>.
 *
 * NUNCA importe este arquivo de codigo client-side.
 */

export function getStorageDir(): string {
  const dir = process.env.CAMOUFLAGE_STORAGE_DIR?.trim();
  if (dir) return path.resolve(dir);
  return path.join(os.tmpdir(), "cloakerdezy-storage");
}

export function getJobDir(jobId: string): string {
  // jobId vem do banco (uuid). Sanitiza por seguranca contra path traversal.
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("jobId invalido");
  return path.join(getStorageDir(), safe);
}

/** Extensao segura (com ponto) a partir de um nome de arquivo. */
export function safeExtension(fileName: string, fallback = ".bin"): string {
  const m = fileName.match(/\.[A-Za-z0-9]{1,8}$/);
  return m ? m[0].toLowerCase() : fallback;
}

/** Grava o arquivo de entrada do job e retorna o caminho absoluto. */
export async function saveInput(jobId: string, fileName: string, data: Uint8Array): Promise<string> {
  const dir = getJobDir(jobId);
  await mkdir(dir, { recursive: true });
  const inputPath = path.join(dir, `input${safeExtension(fileName)}`);
  await writeFile(inputPath, data);
  return inputPath;
}

/** Caminho de saida sugerido para o job (a extensao acompanha a entrada). */
export function outputPathFor(jobId: string, inputName: string): string {
  return path.join(getJobDir(jobId), `output${safeExtension(inputName)}`);
}

export async function readOutput(outputPath: string): Promise<Buffer> {
  return readFile(outputPath);
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Remove todos os arquivos de um job. Best-effort. */
export async function removeJobFiles(jobId: string): Promise<void> {
  try {
    await rm(getJobDir(jobId), { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Remove diretorios de job mais antigos que `maxAgeMs` (TTL). Chamado pelo
 * worker periodicamente pra nao acumular arquivos no disco da VPS.
 */
export async function cleanupExpired(maxAgeMs: number): Promise<number> {
  const root = getStorageDir();
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return 0;
  }
  const now = Date.now();
  for (const entry of entries) {
    const full = path.join(root, entry);
    try {
      const info = await stat(full);
      if (info.isDirectory() && now - info.mtimeMs > maxAgeMs) {
        await rm(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* ignora entradas problematicas */
    }
  }
  return removed;
}
