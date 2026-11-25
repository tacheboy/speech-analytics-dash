import path from "node:path";
import { readUpload } from "@/server/external/uploads";

const TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4" };

/** publicUrl of the Voxxi-compatible presigned upload flow (/api/external/v1/calls/presigned-url). */
export async function GET(_req: Request, ctx: RouteContext<"/uploads/[file]">) {
  const name = path.basename((await ctx.params).file);
  const buf = await readUpload(name);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "content-type": TYPES[path.extname(name)] ?? "application/octet-stream", "accept-ranges": "bytes" } });
}
