/**
 * Runs once when a Next.js server starts. With ROLE=all (the default) the pipeline worker runs inside
 * the web process, so one process (and `./dev.sh`) is the whole product. ROLE=web serves HTTP only;
 * run `npm run worker` (ROLE=worker) separately to scale them independently.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const role = process.env.ROLE ?? "all";
  if (role !== "all") return;
  const { startWorker } = await import("./server/pipeline/worker");
  try {
    await startWorker();
  } catch (e) {
    console.error("[worker] failed to start:", (e as Error).message);
    if (process.env.NODE_ENV === "production") throw e; // fail the start instead of serving without a pipeline
  }
}
