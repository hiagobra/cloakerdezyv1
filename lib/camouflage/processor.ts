import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  type CamouflageJob,
  DEFAULT_TARGET,
  mapPresetToProfile,
  saveJob,
} from "@/lib/camouflage/job-store";

type PythonOutput = {
  output_path?: string;
  outputPath?: string;
  layers_applied?: string[];
};

function getAudioPocPath(): string {
  return (process.env.AUDIO_POC_PATH ?? "").trim();
}

function runPythonProcess(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const explicitBin = process.env.PYTHON_BIN?.trim();
  const candidates = explicitBin
    ? [explicitBin]
    : ["python3", "python", "py"];

  return new Promise((resolve, reject) => {
    let index = 0;
    let lastError = "Python nao encontrado neste ambiente.";

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

      child.on("error", (err) => {
        lastError = `Nao foi possivel executar ${command}: ${err.message}`;
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

async function ensurePipelineAvailable(): Promise<void> {
  const audioPocPath = getAudioPocPath();
  if (!audioPocPath) {
    throw new Error(
      "Pipeline de camuflagem nao configurada. Configure AUDIO_POC_PATH no .env.local.",
    );
  }
  try {
    const stat = await fs.stat(audioPocPath);
    if (!stat.isDirectory()) {
      throw new Error("AUDIO_POC_PATH nao aponta para um diretorio valido.");
    }
  } catch {
    throw new Error(
      `Pipeline de camuflagem indisponivel em ${audioPocPath}. Verifique AUDIO_POC_PATH e a instalacao do Python.`,
    );
  }
}

export async function processJob(job: CamouflageJob): Promise<CamouflageJob> {
  try {
    await ensurePipelineAvailable();

    const outputDir = path.join(path.dirname(job.inputPath), "output");
    await fs.mkdir(outputDir, { recursive: true });

    const profile = mapPresetToProfile(job.preset);
    const targetPreset = job.targetPreset ?? DEFAULT_TARGET;

    const pythonCode = [
      "import json, sys, pathlib",
      "from audio_poc.cloak.composer import cloak_video",
      "input_path, profile, target_preset, output_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]",
      "stem = pathlib.Path(input_path).stem",
      "out = pathlib.Path(output_dir) / (stem + '.cloaked.' + profile + '.' + target_preset + '.mp4')",
      "result = cloak_video(input_path=input_path, output_path=str(out), target_preset=target_preset, profile=profile)",
      "print(json.dumps({'output_path': str(result.output_path), 'layers_applied': list(result.layers_applied)}, ensure_ascii=True))",
    ].join("; ");

    const pythonPath = path.join(getAudioPocPath(), "src");
    const env = {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${pythonPath}${path.delimiter}${process.env.PYTHONPATH}`
        : pythonPath,
    };

    const stdout = await runPythonProcess(
      ["-c", pythonCode, job.inputPath, profile, targetPreset, outputDir],
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
    job.layersApplied = parsed.layers_applied ?? [];
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
