import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * ffmpeg helpers. The binary comes from the `ffmpeg-static` npm package (no system install);
 * FFMPEG_PATH overrides it (e.g. the Docker image's apt ffmpeg).
 */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const p = createRequire(import.meta.url)("ffmpeg-static") as string | null;
  if (!p) throw new Error("ffmpeg not found: install ffmpeg-static or set FFMPEG_PATH");
  return p;
}

function run(args: string[], input: Buffer, timeoutMs = 120_000): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-20_000)));
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out), stderr: err, code: code ?? -1 });
    });
    p.stdin.on("error", () => {}); // ffmpeg may close stdin early on bad input
    p.stdin.end(input);
  });
}

export type Probe = { durationSec: number; channels: number; sampleRate: number; codec: string };

/** Decodes the whole file once (the only reliable duration for odd telephony WAVs) and reads the stream info. */
export async function probe(audio: Buffer): Promise<Probe | null> {
  const { stderr, code } = await run(["-i", "pipe:0", "-map", "0:a:0", "-f", "null", "-"], audio);
  const stream = stderr.match(/Stream #\d+:\d+(?:\[\w+\])?(?:\(\w+\))?: Audio: (\w+)[^,]*, (\d+) Hz, ([^,\n]+)/);
  if (code !== 0 || !stream) return null;
  const layout = stream[3].trim();
  const channels = layout === "mono" ? 1 : layout === "stereo" ? 2 : Number(layout.match(/(\d+) channels/)?.[1] ?? 2);
  // the last progress "time=" is the decoded duration; fall back to the container's Duration
  const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  const t = times.at(-1) ?? stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  const durationSec = t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0;
  return { durationSec, channels, sampleRate: Number(stream[2]), codec: stream[1] };
}

/** Mono mixdown for ASR: 16 kHz, 48 kbps MP3 (small enough for every provider's upload limit). */
export async function asrAudio(audio: Buffer) {
  const { stdout, code, stderr } = await run(["-i", "pipe:0", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", "-f", "mp3", "pipe:1"], audio, 300_000);
  if (code !== 0 || !stdout.length) throw new Error(`ffmpeg mixdown failed: ${stderr.split("\n").slice(-3).join(" ")}`);
  return stdout;
}

/** Browser playback file: AAC in MP4, keeps the channels so the UI can show both sides. */
export async function playbackAudio(audio: Buffer) {
  const { stdout, code, stderr } = await run(["-i", "pipe:0", "-c:a", "aac", "-b:a", "64k", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], audio, 300_000);
  if (code !== 0 || !stdout.length) throw new Error(`ffmpeg playback transcode failed: ${stderr.split("\n").slice(-3).join(" ")}`);
  return stdout;
}

export const FRAME_SEC = 0.02;

/** Per-channel RMS energy in 20 ms frames (stereo only). Returns [left, right] as dB-ish integers. */
export async function channelEnergy(audio: Buffer): Promise<[number[], number[]]> {
  const rate = 8000;
  const { stdout, code } = await run(["-i", "pipe:0", "-ac", "2", "-ar", String(rate), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"], audio, 300_000);
  if (code !== 0) throw new Error("ffmpeg energy extraction failed");
  const frame = Math.round(rate * FRAME_SEC);
  const samples = Math.floor(stdout.length / 4);
  const n = Math.ceil(samples / frame);
  const left = new Array<number>(n).fill(0), right = new Array<number>(n).fill(0);
  for (let f = 0; f < n; f++) {
    let l = 0, r = 0, c = 0;
    for (let i = f * frame; i < Math.min(samples, (f + 1) * frame); i++, c++) {
      const a = stdout.readInt16LE(i * 4), b = stdout.readInt16LE(i * 4 + 2);
      l += a * a;
      r += b * b;
    }
    left[f] = c ? Math.round(10 * Math.log10(l / c + 1)) : 0;
    right[f] = c ? Math.round(10 * Math.log10(r / c + 1)) : 0;
  }
  return [left, right];
}

export const CONTENT_TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", webm: "audio/webm", aac: "audio/aac", amr: "audio/amr" };
