"use client";

import { BarChart3, BellRing, Handshake, Layers, Scale, Settings2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, ScoreBadge, Pill } from "@/components/app/bits";
import { UploadDialog } from "@/components/app/upload-dialog";
import { useDashboard, useWorkspace } from "@/lib/api-client";
import { fmtPct } from "@/lib/format";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { "bell-ring": BellRing, handshake: Handshake, scale: Scale };

function CategoryCard({ id, name, description, icon }: { id: string; name: string; description: string; icon: string }) {
  const { data } = useDashboard({ dimension: "category", id });
  const Icon = ICONS[icon] ?? Layers;
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5 transition hover:border-primary/40">
      <Link href={`/conversations/${id}`} className="group flex-1">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"><Icon className="size-5" /></span>
          <div className="min-w-0">
            <h2 className="font-semibold group-hover:underline">{name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Conversations · 30d</dt><dd className="mt-1 text-lg font-semibold tabular">{data ? data.kpis.volume.value : <Skeleton className="h-6 w-10" />}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Avg score</dt><dd className="mt-1">{data ? <ScoreBadge score={data.kpis.quality.value == null ? null : Math.round(data.kpis.quality.value)} /> : <Skeleton className="h-6 w-12" />}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Success rate</dt><dd className="mt-1 text-lg font-semibold tabular">{data ? fmtPct(data.kpis.successRate.value) : <Skeleton className="h-6 w-10" />}</dd></div>
        </dl>
      </Link>
      <div className="mt-5 flex gap-2 border-t pt-4">
        <Button variant="outline" size="sm" className="gap-1.5" nativeButton={false} render={<Link href={`/analytics/category/${id}`} />}><BarChart3 className="size-3.5" /> Analytics</Button>
        <Button variant="ghost" size="sm" className="gap-1.5" nativeButton={false} render={<Link href={`/conversations/${id}/configuration`} />}><Settings2 className="size-3.5" /> Configuration</Button>
      </div>
    </div>
  );
}

export default function CallsIndexPage() {
  const { data: ws } = useWorkspace();
  return (
    <>
      <PageHeader title="Conversations" description="Pick a conversation category to browse its recordings, or view everything." actions={<><Button variant="outline" nativeButton={false} render={<Link href="/conversations/all" />}>View all recordings</Button><UploadDialog /></>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ws ? ws.categories.map((c) => <CategoryCard key={c.id} {...c} />) : Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
      </div>
      {ws && (
        <p className="mt-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          Each category is scored against its own rubric <Pill tone="muted">sections → yes/no criteria</Pill> with outcomes and extraction fields.
        </p>
      )}
    </>
  );
}
