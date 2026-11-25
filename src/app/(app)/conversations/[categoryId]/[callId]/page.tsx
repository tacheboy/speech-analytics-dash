"use client";

import { AlertTriangle, ArrowLeft, Download, FlaskConical, Link2, Loader2, RotateCcw, ShieldAlert, Tag } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentAvatar, EmptyState, OutcomeBadge, Pill } from "@/components/app/bits";
import { Audit } from "@/components/call/audit";
import { AudioPlayer, type PlayerHandle } from "@/components/call/audio-player";
import { Extractions, LanguageMix, Summary } from "@/components/call/summary";
import { Transcript } from "@/components/call/transcript";
import { useConversation, useReanalyze, useWorkspace } from "@/lib/api-client";
import { scoreTone, type Lang, type TranscriptSegment } from "@/lib/domain";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

function ScoreRing({ score }: { score: number | null }) {
  const r = 26, c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={`Overall score ${score ?? "not applicable"}`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round" stroke={`var(--${tone === "muted" ? "muted-foreground" : tone})`} strokeDasharray={c} strokeDashoffset={c * (1 - (score ?? 0) / 100)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular">{score == null ? "N/A" : `${score}%`}</span>
    </div>
  );
}

const STAGES = ["ingesting", "transcribing", "analyzing"] as const;
const STAGE_COPY = { ingesting: "Fetching and checking the recording", transcribing: "Transcribing and working out who said what", analyzing: "Scoring against the rubric and checking every quote" };

export default function ConversationPage() {
  const { categoryId, callId } = useParams<{ categoryId: string; callId: string }>();
  const { data: call, isLoading, error } = useConversation(callId);
  const { data: ws } = useWorkspace();
  const reanalyze = useReanalyze(callId);
  const player = useRef<PlayerHandle>(null);
  const [time, setTime] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const onTime = useCallback((t: number) => setTime(t), []);
  const seek = (t: number, line?: number) => { player.current?.seek(t); setHighlight(line ?? null); };
  const canAudit = ws?.me.role !== "member";
  const transcript = useMemo<TranscriptSegment[]>(() => (call?.transcript ?? []).map((s) => ({ ...s, speaker: s.speaker === "person" ? "agent" : "customer", lang: s.lang as Lang })), [call?.transcript]);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24 rounded-2xl" /><div className="grid gap-4 lg:grid-cols-12"><Skeleton className="h-96 rounded-2xl lg:col-span-7" /><Skeleton className="h-96 rounded-2xl lg:col-span-5" /></div></div>;
  if (error || !call) return <EmptyState title="Conversation not found" description="This conversation doesn’t exist or you don’t have access to it." action={<Button variant="outline" nativeButton={false} render={<Link href={`/conversations/${categoryId}`} />}>Back to conversations</Button>} />;

  const category = ws?.categories.find((c) => c.id === call.categoryId);
  const copy = () => navigator.clipboard.writeText(window.location.href).then(() => toast.success("Conversation link copied"));
  const simulated = call.analysis?.simulated ?? false;
  const stereo = !simulated && call.audio.channels === 2;
  const busy = call.status === "queued" || call.status === "processing";
  const done = call.status === "completed";
  const rerun = () => reanalyze.mutate(undefined, { onSuccess: () => toast.success("Re-analysis started"), onError: (e) => toast.error(e.message) });

  return (
    <div className="space-y-5">
      <Link href={`/conversations/${call.categoryId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {category?.name ?? call.categoryId}</Link>

      <header className="flex flex-col gap-4 rounded-2xl border bg-card p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AgentAvatar name={call.person.name} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{call.person.name}</h1>
            <p className="text-sm text-muted-foreground">
              {fmtDateTime(call.occurredAt)}{call.audio.durationSec ? ` · ${fmtDuration(call.audio.durationSec)}` : ""} · {call.externalId ?? call.id}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <OutcomeBadge label={call.outcome?.label ?? null} isSuccess={call.outcome ? call.outcome.type === "success" : null} isNotApplicable={call.outcome ? call.outcome.type === "na" : null} />
              {call.riskFlag && <Pill tone="danger"><ShieldAlert className="size-3" /> Risk flag</Pill>}
              {call.tags.map((t) => (
                <Link key={t.slug} href={`/conversations/all?tag=${encodeURIComponent(t.slug)}`} title={`${t.slug}${t.source === "manual" ? " · added by a manager" : " · applied by rule"}`}>
                  <Pill tone={t.source === "manual" ? "primary" : "muted"} className="hover:border-primary/50"><Tag className="size-3" />{t.displayName}</Pill>
                </Link>
              ))}
            </div>
          </div>
        </div>
        {call.metrics && <div className="w-full lg:w-64"><p className="mb-1.5 text-xs text-muted-foreground">Language mix</p><LanguageMix mix={call.metrics.languageMix} /></div>}
        <div className="flex items-center gap-3">
          {done && <ScoreRing score={call.score} />}
          <div className="flex gap-1">
            <Button variant="outline" size="icon" aria-label="Copy link" onClick={copy}><Link2 className="size-4" /></Button>
            {call.audio.playbackUrl && <Button variant="outline" size="icon" aria-label="Download recording" nativeButton={false} render={<a href={call.audio.playbackUrl} download />}><Download className="size-4" /></Button>}
            {canAudit && (done || call.failure?.retryable) && (
              <Button variant="outline" size="icon" aria-label="Re-analyse" title={done ? "Re-analyse with the current rubric (no transcription cost)" : "Retry"} onClick={rerun} disabled={reanalyze.isPending}><RotateCcw className="size-4" /></Button>
            )}
          </div>
        </div>
      </header>

      {simulated && done && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" />
          <p><span className="font-medium">Simulated analysis.</span> No speech-to-text or LLM provider is configured, so the transcript and scores come from a matching demo script, not from your recording. Add provider keys to <code>.env</code> (see Settings) and re-analyse.</p>
        </div>
      )}

      {busy && (
        <div className="rounded-2xl border bg-card p-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-primary" />
            <div><p className="font-medium">{call.status === "queued" ? "Queued for analysis…" : STAGE_COPY[call.stage ?? "ingesting"]}…</p><p className="text-sm text-muted-foreground">This page updates automatically.</p></div>
          </div>
          <ol className="mt-4 flex gap-2 text-xs">
            {STAGES.map((st, i) => {
              const at = call.stage ? STAGES.indexOf(call.stage) : -1;
              return <li key={st} className={cn("flex-1 rounded-full px-3 py-1 text-center capitalize", i < at ? "bg-success/15 text-success" : i === at ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{st}</li>;
            })}
          </ol>
        </div>
      )}
      {(call.status === "failed" || call.status === "skipped") && call.failure && (
        <div className={cn("flex items-center gap-3 rounded-2xl border p-6", call.status === "failed" ? "border-danger/30 bg-danger/8" : "bg-card")}>
          <AlertTriangle className={cn("size-5", call.status === "failed" ? "text-danger" : "text-muted-foreground")} />
          <div className="flex-1">
            <p className="font-medium">{call.status === "skipped" ? "Skipped (not analysed or billed)" : "Analysis failed"} · <code className="text-xs">{call.failure.code}</code></p>
            <p className="text-sm text-muted-foreground">{call.failure.message}</p>
          </div>
          {canAudit && call.failure.retryable && <Button variant="outline" onClick={rerun} disabled={reanalyze.isPending}>Retry</Button>}
        </div>
      )}

      {done && (
        <div className="grid items-start gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:sticky lg:top-20 lg:col-span-7">
            {call.audio.playbackUrl && <AudioPlayer ref={player} url={call.audio.playbackUrl} agentName={call.person.name} moments={simulated ? [] : call.moments ?? []} onTime={onTime} stereo={stereo} />}
            <Transcript segments={transcript} agentName={call.person.name} time={simulated ? -1 : time} onSeek={(t) => seek(t)} highlight={highlight} />
          </div>
          <div className="rounded-2xl border bg-card p-5 lg:col-span-5">
            <Tabs defaultValue="audit">
              <TabsList className="mb-4 w-full">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="audit">Scorecard</TabsTrigger>
                <TabsTrigger value="data">Data</TabsTrigger>
              </TabsList>
              <TabsContent value="summary"><Summary call={call} /></TabsContent>
              <TabsContent value="audit"><Audit key={`${call.analysis?.id}:${call.audit?.auditedAt ?? "new"}`} call={call} canAudit={canAudit} onSeek={seek} assignableTags={(ws?.tags ?? []).filter((t) => t.assignable && t.slug.includes("/")).map((t) => ({ slug: t.slug, displayName: t.displayName }))} /></TabsContent>
              <TabsContent value="data"><Extractions call={call} fields={category?.rubric.extractionFields ?? []} /></TabsContent>
            </Tabs>
          </div>
        </div>
      )}
      {done && (
        <p className="text-xs text-muted-foreground">
          Rubric version {call.rubricVersion}
          {call.analysis && <> · transcribed by <code>{call.analysis.models.asr}</code> · scored by <code>{call.analysis.models.llm}</code> · prompt {call.analysis.promptVersion}</>}
          {" "}· criteria can be overridden by managers; overrides are kept alongside the AI result.
        </p>
      )}
    </div>
  );
}
