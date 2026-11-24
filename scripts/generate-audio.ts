/**
 * One-off (macOS only): turns each call template into a stereo recording with the system TTS voices.
 * Agent on the left channel, customer on the right — like a dual-channel dialer recording.
 * Writes public/audio/<id>.m4a and content/generated/timings.json (exact segment timestamps).
 * Usage: npm run audio:generate [-- <id-prefix>]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadTemplates, loadTimings, type Timings } from "@/server/content";
import type { CallTemplate } from "@/lib/domain";

const RATE = 16000;
const CUSTOMER_VOICE = { "ta-en": "Vani", "kn-en": "Soumya", "hi-en": "Lekha" } as const;
const AGENT_VOICES = ["Rishi", "Aman"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tts-"));
const outDir = path.join(process.cwd(), "public", "audio");
const timingsFile = path.join(process.cwd(), "content", "generated", "timings.json");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.dirname(timingsFile), { recursive: true });

function pcm(file: string): Int16Array {
  const buf = fs.readFileSync(file);
  let off = 12; // skip RIFF header, walk chunks to "data"
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return new Int16Array(buf.buffer.slice(buf.byteOffset + off + 8, buf.byteOffset + off + 8 + size));
    off += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

function speak(voice: string, text: string, i: number): Int16Array {
  const f = path.join(tmp, `l${i}.wav`);
  execFileSync("say", ["-v", voice, "-r", "175", "-o", f, "--file-format=WAVE", `--data-format=LEI16@${RATE}`, text]);
  return pcm(f);
}

function render(t: CallTemplate, idx: number) {
  const agentVoice = AGENT_VOICES[idx % AGENT_VOICES.length];
  const clips = t.lines.map((l, i) => speak(l.speaker === "agent" ? agentVoice : CUSTOMER_VOICE[t.language], l.text, i));
  // natural turn gaps, deterministic per line
  const gaps = t.lines.map((_, i) => Math.round(RATE * (0.35 + ((i * 37 + idx * 11) % 40) / 100)));
  const lead = Math.round(RATE * 0.6);
  const total = lead + clips.reduce((s, c, i) => s + c.length + gaps[i], 0);
  const stereo = new Int16Array(total * 2);
  const segments: { start: number; end: number }[] = [];
  let pos = lead;
  clips.forEach((c, i) => {
    const ch = t.lines[i].speaker === "agent" ? 0 : 1;
    for (let s = 0; s < c.length; s++) stereo[(pos + s) * 2 + ch] = c[s];
    segments.push({ start: +(pos / RATE).toFixed(2), end: +((pos + c.length) / RATE).toFixed(2) });
    pos += c.length + gaps[i];
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + stereo.byteLength, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(stereo.byteLength, 40);
  const wav = path.join(tmp, `${t.id}.wav`);
  fs.writeFileSync(wav, Buffer.concat([header, Buffer.from(stereo.buffer)]));
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "48000", wav, path.join(outDir, `${t.id}.m4a`)]);
  return { duration: +(total / RATE).toFixed(2), segments };
}

/**
 * English lexicon for the language-mix metric: Latin-script words in the transcripts that are English.
 * Built from the macOS word list minus romanised Indic words that collide with English spellings.
 */
const INDIC_COLLISIONS = new Set("la hoon main se mein hain ho ma ah ji um sari ide ge ko na jo ella hoga theek ka anta amma aa seri andre panna par bas tha karo bahut do to ta hi kar he me ke ki aap hum ham bhi tum yaar ne pe ye vo wo jab tab ab sab kuch haan nahin accha ok illa alli adu idhu enna inga anga sollu romba konjam saar".split(" "));
const DOMAIN = ["emi", "emis", "rupees", "charges", "calls", "upi", "okay", "email", "cibil", "digits", "recorded", "bills", "sms", "noc", "nbfc", "kyc", "otp", "pan", "ecs", "nach", "dpd"];
function buildLexicon(templates: CallTemplate[]) {
  const dict = new Set(fs.readFileSync("/usr/share/dict/words", "utf8").toLowerCase().split("\n"));
  const words = new Set<string>(DOMAIN);
  for (const t of templates) for (const l of t.lines) for (const w of l.text.toLowerCase().match(/[a-z]+/g) ?? []) if (dict.has(w) && !INDIC_COLLISIONS.has(w)) words.add(w);
  fs.writeFileSync(path.join(process.cwd(), "content", "generated", "english-lexicon.json"), JSON.stringify([...words].sort()));
  return words.size;
}

const prefix = process.argv[2] ?? "";
const timings: Timings = loadTimings();
loadTemplates().forEach((t, idx) => {
  if (!t.id.startsWith(prefix)) return;
  timings[t.id] = render(t, idx);
  console.log(`✓ ${t.id}  ${timings[t.id].duration}s`);
});
fs.writeFileSync(timingsFile, JSON.stringify(timings, null, 1));
console.log(`✓ english lexicon: ${buildLexicon(loadTemplates())} words`);
fs.rmSync(tmp, { recursive: true, force: true });
