/**
 * Standalone worker (ROLE=worker): `npm run worker`. Same code as the in-process worker the web server
 * starts with ROLE=all; run several of these to scale processing independently of the web tier.
 */
import "dotenv/config";
import { startWorker, stopWorker } from "@/server/pipeline/worker";

async function main() {
  await startWorker();
  const stop = async (sig: string) => {
    console.log(`[worker] ${sig}: finishing in-flight jobs…`);
    await stopWorker();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] failed to start:", e);
  process.exit(1);
});
