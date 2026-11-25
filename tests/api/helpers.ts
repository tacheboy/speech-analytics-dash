import { spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ffmpegPath } from "@/server/pipeline/audio";

export const AUTH = { authorization: "Bearer test_key" };
export const none = undefined as never;
export const params = <T extends Record<string, string | string[]>>(p: T) => ({ params: Promise.resolve(p) });

export function req(url: string, init: RequestInit & { json?: unknown; key?: Record<string, string> } = {}) {
  return new Request(url.startsWith("http") ? url : `http://test${url}`, {
    ...init,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    headers: { ...(init.key ?? AUTH), ...(init.json !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
}

export const json = async (r: Response) => ({ status: r.status, headers: r.headers, body: r.status === 204 ? null : await r.json() });
export const uniq = () => Math.random().toString(36).slice(2, 10);

export async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 45_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (done(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting; last value: ${JSON.stringify(v).slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** A real audio file made by ffmpeg: stereo sine tones (left/right alternate), `seconds` long. */
export function toneMp3(seconds: number): Buffer {
  const r = spawnSync(ffmpegPath(), ["-hide_banner", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-f", "lavfi", "-i", `sine=frequency=660:duration=${seconds}`,
    "-filter_complex", "[0:a][1:a]join=inputs=2:channel_layout=stereo[a]", "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1"], { maxBuffer: 50 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
}

/** A local HTTP server: records webhook POSTs and serves /audio.mp3 and /missing (404). */
export async function localServer(audio?: Buffer) {
  const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((rq, rs) => {
    if (rq.method === "GET" && rq.url === "/audio.mp3" && audio) {
      rs.writeHead(200, { "content-type": "audio/mpeg" });
      return rs.end(audio);
    }
    if (rq.method === "GET") {
      rs.writeHead(404);
      return rs.end();
    }
    let body = "";
    rq.on("data", (c) => (body += c));
    rq.on("end", () => {
      received.push({ headers: rq.headers, body });
      rs.writeHead(rq.url === "/fail" ? 500 : 200, { "content-type": "application/json" });
      rs.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, received, close: () => new Promise<void>((r) => server.close(() => r())) };
}
