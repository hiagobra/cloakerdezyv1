import { runWorkerLoop } from "@/lib/camouflage/worker";

async function main() {
  console.log("Camouflage worker iniciado.");
  await runWorkerLoop();
}

main().catch((error) => {
  console.error("Falha fatal no worker:", error);
  process.exit(1);
});

