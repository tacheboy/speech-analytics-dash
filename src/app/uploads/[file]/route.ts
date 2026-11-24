import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "@/server/services/calls";

const TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4" };

/** Serves recordings uploaded at runtime (public/ is only served for files present at build time). */
export async function GET(_req: Request, ctx: RouteContext<"/uploads/[file]">) {
  const name = path.basename((await ctx.params).file);
  try {
    const buf = await fs.readFile(path.join(UPLOAD_DIR, name));
    return new Response(buf, { headers: { "content-type": TYPES[path.extname(name)] ?? "application/octet-stream", "accept-ranges": "bytes" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
