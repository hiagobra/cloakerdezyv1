import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import { type CamouflageJob, mapPreset, saveJob } from "@/lib/camouflage/job-store";

type PythonOutput = {
  output_path?: string;
  outputPath?: string;
};

const AUDIO_POC_PATH =
  process.env.AUDIO_POC_PATH ?? "C:/Users/hiago/Downloads/www.maskai.co/audio-encryption-poc";

function runPythonProcess(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const candidates = ["python", "py"];

  return new Promise((resolve, reject) => {
    let index = 0;
    let lastError = "Python nao encontrado.";

    const next = () => {
      if (index >= candidates.length) {
        reject(new Error(lastError));
        return;
      }

      const command = candidates[index];
      const fullArgs = command === "py" ? ["-3", ...args] : args;
      index += 1;

      const child = spawn(command, fullArgs, {
        env,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", () => {
        lastError = `Nao foi possivel executar ${command}.`;
        next();
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
          return;
        }

        lastError = `Falha ao executar pipeline Python (${command}). ${stderr || stdout}`;
        next();
      });
    };

    next();
  });
}

export async function processJob(job: CamouflageJob): Promise<CamouflageJob> {
  try {
    const outputDir = path.join(path.dirname(job.inputPath), "output");
    await fs.mkdir(outputDir, { recursive: true });

    const pythonCode = [
      "import json, sys",
      "from audio_poc.video_pipeline import process_uploaded_media",
      "result = process_uploaded_media(sys.argv[1], sys.argv[2], sys.argv[3])",
      "print(json.dumps({'output_path': str(result.output_path)}, ensure_ascii=True))",
    ].join("; ");

    const pythonPath = path.join(AUDIO_POC_PATH, "src");
    const env = {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${pythonPath}${path.delimiter}${process.env.PYTHONPATH}`
        : pythonPath,
    };

    const stdout = await runPythonProcess(
      ["-c", pythonCode, job.inputPath, mapPreset(job.preset), outputDir],
      env,
    );

    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const jsonLine = lines[lines.length - 1];
    const parsed = JSON.parse(jsonLine) as PythonOutput;
    const outputPath = parsed.output_path ?? parsed.outputPath;

    if (!outputPath) {
      throw new Error("Pipeline executado sem output_path.");
    }

    job.status = "done";
    job.outputPath = outputPath;
    job.error = undefined;
    await saveJob(job);
    return job;
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Falha ao processar.";
    await saveJob(job);
    return job;
  }
}

