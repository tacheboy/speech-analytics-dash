"use client";

import { Cpu } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { AgentAvatar, PageHeader, Panel, Pill } from "@/components/app/bits";
import { useWorkspace } from "@/lib/api-client";

const KEY_LABEL: Record<string, string> = {
  ANTHROPIC_API_KEY: "Anthropic (Claude)", OPENAI_API_KEY: "OpenAI", GEMINI_API_KEY: "Google Gemini", SARVAM_API_KEY: "Sarvam (Indic ASR)",
  DEEPGRAM_API_KEY: "Deepgram", OPENAI_COMPAT_BASE_URL: "OpenAI-compatible endpoint (OpenRouter, Azure, Groq, vLLM, Ollama…)",
};

/** Read-only by design: keys live in the server's environment (.env), never in the database. */
function ProvidersPanel({ system }: { system: { llm: string | null; asr: string | null; llmFallback: string | null; asrFallback: string | null; mock: boolean; keys: Record<string, boolean>; error: string | null; storage: string } }) {
  const row = (label: string, value: string | null, hint?: string) => (
    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value ? <code className="text-xs">{value}</code> : <span className="text-muted-foreground">none</span>}{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </div>
  );
  return (
    <Panel title="AI providers" icon={<Cpu className="size-4" />} description="Speech-to-text and scoring models used by the pipeline. Set in the server's .env; changes apply on restart.">
      {system.error && <p className="mb-3 rounded-lg border border-danger/30 bg-danger/8 px-3 py-2 text-sm text-danger">{system.error}</p>}
      {system.mock && <p className="mb-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-sm">Running on mock providers: analyses replay the demo scripts. Add a key below to analyse real recordings.</p>}
      <div className="divide-y">
        {row("Scoring model (LLM_MODEL)", system.llm)}
        {row("Fallback (LLM_FALLBACK)", system.llmFallback, "used when the primary is down")}
        {row("Speech-to-text (ASR_MODEL)", system.asr)}
        {row("Fallback (ASR_FALLBACK)", system.asrFallback)}
        {row("Audio storage", system.storage === "s3" ? "S3-compatible bucket" : "local disk")}
      </div>
      {Object.keys(system.keys).length > 0 && (
        <>
          <p className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Keys found in the environment</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {Object.entries(system.keys).map(([k, on]) => (
              <li key={k} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs">
                <span><span className="block font-medium">{KEY_LABEL[k] ?? k}</span><code className="text-muted-foreground">{k}</code></span>
                <Pill tone={on ? "success" : "muted"}>{on ? "set" : "not set"}</Pill>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Pick models with <code>LLM_MODEL=provider:model</code> (e.g. <code>anthropic:claude-opus-5-5</code>, <code>openai:&lt;model&gt;</code>, <code>compat:&lt;model&gt;</code>). Run <code>npm run providers:check</code> after adding a key. Compare models on the golden set with <code>npm run eval</code>.</p>
        </>
      )}
    </Panel>
  );
}

export default function SettingsPage() {
  const { data: ws } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  if (!ws) return null;
  return (
    <>
      <PageHeader title="Settings" description="Your account, preferences and how this instance is configured." />
      <div className="grid max-w-3xl gap-5">
        <Panel title="Profile">
          <div className="flex items-center gap-4"><AgentAvatar name={ws.me.name} size="lg" /><div><p className="font-medium">{ws.me.name}</p><p className="text-sm text-muted-foreground">{ws.me.email} · <span className="capitalize">{ws.me.role}</span> at {ws.org.name}</p></div></div>
        </Panel>
        <Panel title="Appearance">
          <div className="flex gap-2">{(["dark", "light"] as const).map((t) => <Button key={t} variant={resolvedTheme === t ? "default" : "outline"} onClick={() => setTheme(t)} className="capitalize">{t}</Button>)}</div>
        </Panel>
        <ProvidersPanel system={ws.system} />
        <Panel title="Sign-in methods"><p className="text-sm text-muted-foreground">This demo uses seeded users without passwords. Production would use SSO (Google / Microsoft) or email + password.</p></Panel>
      </div>
    </>
  );
}
