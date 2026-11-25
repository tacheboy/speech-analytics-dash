"use client";

import { AlertTriangle, ArrowLeft, Download, FlaskConical, Link2, Loader2, ShieldAlert, Tag } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentAvatar, EmptyState, OutcomeBadge, Pill } from "@/components/app/bits";
import { Audit } from "@/components/call/audit";
import { AudioPlayer, type PlayerHandle } from "@/components/call/audio-player";
import { Extractions, LanguageMix, Summary } from "@/components/call/summary";
import { Transcript } from "@/components/call/transcript";
import { useCall, useWorkspace } from "@/lib/api-client";
import { scoreTone } from "@/lib/domain";
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

export default function CallDetailPage() {
  const { categoryId, callId } = useParams<{ categoryId: string; callId: string }>();
  const { data: call, isLoading, error } = useCall(callId);
  const { data: ws } = useWorkspace();
  const player = useRef<PlayerHandle>(null);
  const [time, setTime] = useState(0);
  const [highlight, setHighlight] = useState<number | null>(null);
  const onTime = useCallback((t: number) => setTime(t), []);
  const seek = (t: number, line?: number) => { player.current?.seek(t); setHighlight(line ?? null); };
  const canReview = ws?.me.role !== "member";

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-24 rounded-2xl" /><div className="grid gap-4 lg:grid-cols-12"><Skeleton className="h-96 rounded-2xl lg:col-span-7" /><Skeleton className="h-96 rounded-2xl lg:col-span-5" /></div></div>;
  if (error || !call) return <EmptyState title="Conversation not found" description="This conversation doesn’t exist or you don’t have access to it." action={<Button variant="outline" nativeButton={false} render={<Link href={`/conversations/${categoryId}`} />}>Back to conversations</Button>} />;

  const copy = () => navigator.clipboard.writeText(window.location.href).then(() => toast.success("Conversation link copied"));
  const stereo = !call.isSimulated && !!call.templateId;

  return (
    <div className="space-y-5">
      <Link href={`/conversations/${call.categoryId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {call.category.name}</Link>

      <header className="flex flex-col gap-4 rounded-2xl border bg-card p-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <AgentAvatar name={call.agentName} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{call.agentName}</h1>
            <p className="text-sm text-muted-foreground">{fmtDateTime(call.callAt)} · {fmtDuration(call.durationSec)} · {call.id.replace("call_", "#")} · {call.uploadedByName ? `uploaded by ${call.uploadedByName}` : "from dialer"}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <OutcomeBadge label={call.outcome?.label ?? null} isSuccess={call.isSuccess} isNotApplicable={call.isNotApplicable} />
              {call.complianceFlag && <Pill tone="danger"><ShieldAlert className="size-3" /> RBI risk flag</Pill>}
              {call.tags.map((t) => (
                <Link key={t.id} href={`/conversations/all?tag=${encodeURIComponent(t.slug)}`} title={`${t.slug}${t.source === "manual" ? " · added by a manager" : " · applied by rule"}`}>
                  <Pill tone={t.source === "manual" ? "primary" : "muted"} className="hover:border-primary/50"><Tag className="size-3" />{t.displayName}</Pill>
                </Link>
              ))}
            </div>
          </div>
        </div>
        {call.metrics && <div className="w-full lg:w-64"><p className="mb-1.5 text-xs text-muted-foreground">Language mix</p><LanguageMix mix={call.metrics.languageMix} /></div>}
        <div className="flex items-center gap-3">
          {call.status === "done" && <ScoreRing score={call.isNotApplicable ? null : call.score} />}
          <div className="flex gap-1">
            <Button variant="outline" size="icon" aria-label="Copy link" onClick={copy}><Link2 className="size-4" /></Button>
            {call.audioUrl && <Button variant="outline" size="icon" aria-label="Download recording" nativeButton={false} render={<a href={call.audioUrl} download />}><Download className="size-4" /></Button>}
          </div>
        </div>
      </header>

      {call.isSimulated && call.status === "done" && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" />
          <p><span className="font-medium">Simulated analysis.</span> This build has no speech-to-text, so the transcript and scores below come from a matching demo conversation, not from your recording. The audio is yours.</p>
        </div>
      )}

      {call.status === "processing" && (
        <div className="flex items-center gap-3 rounded-2xl border bg-card p-6">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div><p className="font-medium">Analyzing this conversation…</p><p className="text-sm text-muted-foreground">Transcribing, extracting fields and scoring against the {call.category.name} rubric. This page updates automatically.</p></div>
        </div>
      )}
      {call.status === "failed" && (
        <div className="flex items-center gap-3 rounded-2xl border border-danger/30 bg-danger/8 p-6">
          <AlertTriangle className="size-5 text-danger" />
          <div><p className="font-medium">Analysis failed</p><p className="text-sm text-muted-foreground">{call.failureReason}</p></div>
        </div>
      )}

      {call.status === "done" && (
        <div className="grid items-start gap-5 lg:grid-cols-12">
          <div className="space-y-5 lg:sticky lg:top-20 lg:col-span-7">
            {call.audioUrl && <AudioPlayer ref={player} url={call.audioUrl} agentName={call.agentName} moments={call.isSimulated ? [] : call.moments ?? []} onTime={onTime} stereo={stereo} />}
            <Transcript segments={call.transcript ?? []} agentName={call.agentName} time={call.isSimulated ? -1 : time} onSeek={(t) => seek(t)} highlight={highlight} />
          </div>
          <div className="rounded-2xl border bg-card p-5 lg:col-span-5">
            <Tabs defaultValue="audit">
              <TabsList className="mb-4 w-full">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="audit">Scorecard</TabsTrigger>
                <TabsTrigger value="data">Data</TabsTrigger>
              </TabsList>
              <TabsContent value="summary"><Summary call={call} /></TabsContent>
              <TabsContent value="audit"><Audit key={call.reviewedAt ? String(call.reviewedAt) : "new"} call={call} canReview={canReview} onSeek={seek} assignableTags={(ws?.tags ?? []).filter((t) => t.assignable && t.slug.includes("/")).map((t) => ({ id: t.id, displayName: t.displayName }))} /></TabsContent>
              <TabsContent value="data"><Extractions call={call} /></TabsContent>
            </Tabs>
          </div>
        </div>
      )}
      <p className={cn("text-xs text-muted-foreground", call.status !== "done" && "hidden")}>Rubric version {call.rubricVersion} · scored criteria can be overridden by managers; overrides are kept alongside the AI result.</p>
    </div>
  );
}
