import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type CamouflagePreset = "leve" | "medio" | "forte";
export type CamouflageStatus = "queued" | "processing" | "done" | "failed";

export type CamouflageJob = {
  id: string;
  fileName: string;
  preset: CamouflagePreset;
  createdAt: string;
  updatedAt: string;
  status: CamouflageStatus;
  inputPath: string;
  outputPath?: string;
  error?: string;
};

const defaultStorage = path.join(os.tmpdir(), "cloakerdezy-storage");

export function getStorageRoot(): string {
  return process.env.CAMOUFLAGE_STORAGE_DIR ?? defaultStorage;
}

export function mapPreset(preset: CamouflagePreset): "light" | "balanced" | "aggressive" {
  if (preset === "leve") return "light";
  if (preset === "forte") return "aggressive";
  return "balanced";
}

function getJobsDir(): string {
  return path.join(getStorageRoot(), "jobs");
}

function getJobDir(id: string): string {
  return path.join(getJobsDir(), id);
}

function getJobMetaPath(id: string): string {
  return path.join(getJobDir(id), "job.json");
}

export async function ensureStorageDirs(): Promise<void> {
  await fs.mkdir(getJobsDir(), { recursive: true });
}

export async function createJob(fileName: string, preset: CamouflagePreset, bytes: Buffer): Promise<CamouflageJob> {
  await ensureStorageDirs();
  const id = randomUUID();
  const dir = getJobDir(id);
  await fs.mkdir(dir, { recursive: true });

  const inputExt = path.extname(fileName) || ".bin";
  const inputPath = path.join(dir, `input${inputExt}`);
  await fs.writeFile(inputPath, bytes);

  const now = new Date().toISOString();
  const job: CamouflageJob = {
    id,
    fileName,
    preset,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    inputPath,
  };

  await fs.writeFile(getJobMetaPath(id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

export async function getJob(id: string): Promise<CamouflageJob | null> {
  try {
    const raw = await fs.readFile(getJobMetaPath(id), "utf8");
    return JSON.parse(raw) as CamouflageJob;
  } catch {
    return null;
  }
}

export async function saveJob(job: CamouflageJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await fs.writeFile(getJobMetaPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

export async function listJobs(): Promise<CamouflageJob[]> {
  await ensureStorageDirs();
  const entries = await fs.readdir(getJobsDir(), { withFileTypes: true });
  const jobs: CamouflageJob[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await getJob(entry.name);
    if (job) jobs.push(job);
  }

  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return jobs;
}

export async function claimQueuedJob(): Promise<CamouflageJob | null> {
  const jobs = await listJobs();
  const queued = jobs.find((job) => job.status === "queued");
  if (!queued) return null;

  queued.status = "processing";
  await saveJob(queued);
  return queued;
}

export async function claimJobById(id: string): Promise<CamouflageJob | null> {
  const job = await getJob(id);
  if (!job || job.status !== "queued") {
    return null;
  }

  job.status = "processing";
  await saveJob(job);
  return job;
}

