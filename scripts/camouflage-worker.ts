import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { runWorkerLoop } = await import("@/lib/camouflage/worker");
  console.log("Camouflage worker iniciado.");
  await runWorkerLoop();
}

main().catch((error) => {
  console.error("Falha fatal no worker:", error);
  process.exit(1);
});
