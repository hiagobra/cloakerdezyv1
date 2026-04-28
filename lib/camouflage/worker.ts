import { claimQueuedJob } from "@/lib/camouflage/job-store";
import { processJob } from "@/lib/camouflage/processor";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWorkerLoop(): Promise<void> {
  while (true) {
    const nextJob = await claimQueuedJob();
    if (!nextJob) {
      await sleep(2000);
      continue;
    }

    await processJob(nextJob);
  }
}

