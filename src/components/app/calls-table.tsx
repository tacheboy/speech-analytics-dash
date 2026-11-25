"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download, Filter, Link2, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCalls, useWorkspace } from "@/lib/api-client";
import type { ListCallsQuery } from "@/lib/contracts";
import { DURATION_BUCKETS, SCORE_BUCKETS } from "@/lib/domain";
import { fmtDate, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AgentAvatar, EmptyState, OutcomeBadge, ScoreBadge, StatusBadge } from "./bits";
import { DateRangePicker } from "./date-range";

const SORTS = ["agent", "duration", "score", "date"] as const;
const filterParsers = {
  q: parseAsString,
  agentId: parseAsString,
  teamId: parseAsString,
  outcome: parseAsString,
  tag: parseAsString, // tag slug, any level of the hierarchy
  ext: parseAsString, // extracted value "field:value"
  status: parseAsStringLiteral(["all", "done", "processing", "failed"] as const),
  scoreBucket: parseAsStringLiteral(Object.keys(SCORE_BUCKETS) as (keyof typeof SCORE_BUCKETS)[]),
  durationBucket: parseAsStringLiteral(Object.keys(DURATION_BUCKETS) as (keyof typeof DURATION_BUCKETS)[]),
  reviewed: parseAsStringLiteral(["true", "false"] as const),
  compliance: parseAsStringLiteral(["true"] as const),
  from: parseAsString,
  to: parseAsString,
  sort: parseAsStringLiteral(SORTS),
  order: parseAsStringLiteral(["asc", "desc"] as const),
  page: parseAsInteger,
};

type Opt = { value: string; label: string };
type SortKey = (typeof SORTS)[number];
function SortHead({ s, current, order, onSort, children, className }: { s: SortKey; current: string; order: string; onSort: (s: SortKey) => void; children: React.ReactNode; className?: string }) {
  return (
    <TableHead className={className}>
      <button className="inline-flex items-center gap-1.5 hover:text-foreground" onClick={() => onSort(s)}>
        {children}
        {current === s ? (order === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowUpDown className="size-3.5 opacity-50" />}
      </button>
    </TableHead>
  );
}
function FilterSelect({ label, value, options, onChange }: { label: string; value: string | null; options: Opt[]; onChange: (v: string | null) => void }) {
  const items = [{ value: "__any", label: `Any ${label.toLowerCase()}` }, ...options];
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Select items={items} value={value ?? "__any"} onValueChange={(v) => onChange(!v || v === "__any" ? null : String(v))}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  );
}

/**
 * The call list used across the app. Filters live in the URL so every view is shareable.
 * `fixed` filters (e.g. category, or the review queue's "unreviewed") are applied but not shown as chips.
 */
export function CallsTable({ categoryId, fixed, hideFilters, pageSize = 20, compact }: { categoryId?: string; fixed?: Partial<ListCallsQuery>; hideFilters?: boolean; pageSize?: number; compact?: boolean }) {
  const router = useRouter();
  const { data: ws } = useWorkspace();
  const [f, setF] = useQueryStates(filterParsers, { history: "replace" });
  const [search, setSearch] = useState(f.q ?? "");
  useEffect(() => {
    const t = setTimeout(() => { if ((f.q ?? "") !== search) setF({ q: search || null, page: null }); }, 300);
    return () => clearTimeout(t);
  }, [search, f.q, setF]);

  const query: ListCallsQuery = {
    categoryId: categoryId === "all" ? undefined : categoryId,
    q: f.q ?? undefined, agentId: f.agentId ?? undefined, teamId: f.teamId ?? undefined, outcome: f.outcome ?? undefined, tag: f.tag ?? undefined, ext: f.ext ?? undefined,
    status: f.status ?? "all", scoreBucket: f.scoreBucket ?? undefined, durationBucket: f.durationBucket ?? undefined,
    reviewed: f.reviewed ?? undefined, compliance: f.compliance ?? undefined, from: f.from ?? undefined, to: f.to ?? undefined,
    sort: f.sort ?? "date", order: f.order ?? "desc", page: f.page ?? 1, pageSize,
    ...fixed,
  };
  const { data, isLoading, isFetching, refetch, isError } = useCalls(query);
  const isAgent = ws?.me.role === "agent";

  const outcomeOptions = useMemo(() => {
    const cats = ws?.categories.filter((c) => !categoryId || categoryId === "all" || c.id === categoryId) ?? [];
    return [...new Set(cats.flatMap((c) => c.rubric.outcomes.map((o) => o.label)))].map((l) => ({ value: l, label: l }));
  }, [ws, categoryId]);
  const tagPath = (slug: string) => slug.split("/").map((_, i, a) => ws?.tags.find((x) => x.slug === a.slice(0, i + 1).join("/"))?.displayName ?? a[i]).join(" › ");
  const tagOptions = [...(ws?.tags ?? [])].sort((a, b) => a.slug.localeCompare(b.slug)).map((x) => ({ value: x.slug, label: `${"\u00a0\u00a0".repeat(x.slug.split("/").length - 1)}${x.slug.includes("/") ? "› " : ""}${x.displayName}` }));
  const name = (list: { id: string; name?: string; displayName?: string }[] | undefined, id: string | null) => list?.find((x) => x.id === id)?.name ?? list?.find((x) => x.id === id)?.displayName ?? id;

  const chips: { label: string; clear: () => void }[] = [];
  if (f.agentId) chips.push({ label: `Agent: ${name(ws?.agents, f.agentId)}`, clear: () => setF({ agentId: null, page: null }) });
  if (f.teamId) chips.push({ label: `Team: ${name(ws?.teams, f.teamId)}`, clear: () => setF({ teamId: null, page: null }) });
  if (f.outcome) chips.push({ label: `Outcome: ${f.outcome}`, clear: () => setF({ outcome: null, page: null }) });
  if (f.status && f.status !== "all") chips.push({ label: `Status: ${f.status === "done" ? "Analyzed" : f.status}`, clear: () => setF({ status: null, page: null }) });
  if (f.scoreBucket) chips.push({ label: `Score: ${SCORE_BUCKETS[f.scoreBucket].label}`, clear: () => setF({ scoreBucket: null, page: null }) });
  if (f.durationBucket) chips.push({ label: `Duration: ${DURATION_BUCKETS[f.durationBucket].label}`, clear: () => setF({ durationBucket: null, page: null }) });
  if (f.tag) chips.push({ label: `Tag: ${tagPath(f.tag)}${ws?.tags.some((x) => x.slug.startsWith(`${f.tag}/`)) ? " (all)" : ""}`, clear: () => setF({ tag: null, page: null }) });
  if (f.ext) {
    const [field, ...rest] = f.ext.split(":");
    const def = ws?.categories.flatMap((c) => c.rubric.extractionFields).find((x) => x.fieldName === field);
    chips.push({ label: `${def?.displayName ?? field}: ${rest.join(":").replace(/_/g, " ")}`, clear: () => setF({ ext: null, page: null }) });
  }
  if (f.reviewed) chips.push({ label: f.reviewed === "true" ? "Reviewed" : "Not reviewed", clear: () => setF({ reviewed: null, page: null }) });
  if (f.compliance) chips.push({ label: "Compliance flagged", clear: () => setF({ compliance: null, page: null }) });
  if (f.from && f.to) chips.push({ label: `${fmtDate(f.from)} – ${fmtDate(f.to)}`, clear: () => setF({ from: null, to: null, page: null }) });

  const sortBy = (s: SortKey) =>
    setF({ sort: s, order: query.sort === s && query.order === "desc" ? "asc" : "desc", page: null });

  const copyLink = (id: string, cat: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/calls/${cat}/${id}`).then(() => toast.success("Call link copied"), () => toast.error("Could not copy the link"));
  };
  const total = data?.total ?? 0;
  const page = f.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {!hideFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isAgent ? "Search by call ID…" : "Search by agent name or call ID…"} className="h-9 pl-9" aria-label="Search calls" />
          </div>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" className="h-9 gap-2" />}>
              <Filter className="size-4" /> Filters
              {chips.length > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular">{chips.length}</span>}
            </PopoverTrigger>
            <PopoverContent align="start" className="grid w-[min(92vw,560px)] grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              {!isAgent && <FilterSelect label="Agent" value={f.agentId} options={(ws?.agents ?? []).map((a) => ({ value: a.id, label: a.name }))} onChange={(v) => setF({ agentId: v, page: null })} />}
              {!isAgent && <FilterSelect label="Team" value={f.teamId} options={(ws?.teams ?? []).map((t) => ({ value: t.id, label: t.name }))} onChange={(v) => setF({ teamId: v, page: null })} />}
              <FilterSelect label="Outcome" value={f.outcome} options={outcomeOptions} onChange={(v) => setF({ outcome: v, page: null })} />
              <FilterSelect label="Analysis status" value={f.status === "all" ? null : f.status} options={[{ value: "done", label: "Analyzed" }, { value: "processing", label: "Processing" }, { value: "failed", label: "Failed" }]} onChange={(v) => setF({ status: v as typeof f.status, page: null })} />
              <FilterSelect label="Quality score" value={f.scoreBucket} options={Object.entries(SCORE_BUCKETS).map(([k, b]) => ({ value: k, label: b.label }))} onChange={(v) => setF({ scoreBucket: v as typeof f.scoreBucket, page: null })} />
              <FilterSelect label="Duration" value={f.durationBucket} options={Object.entries(DURATION_BUCKETS).map(([k, b]) => ({ value: k, label: b.label }))} onChange={(v) => setF({ durationBucket: v as typeof f.durationBucket, page: null })} />
              <FilterSelect label="Tag (any level)" value={f.tag} options={tagOptions} onChange={(v) => setF({ tag: v, page: null })} />
              {!fixed?.reviewed && <FilterSelect label="Manager review" value={f.reviewed} options={[{ value: "true", label: "Reviewed" }, { value: "false", label: "Not reviewed" }]} onChange={(v) => setF({ reviewed: v as typeof f.reviewed, page: null })} />}
              {!fixed?.compliance && <FilterSelect label="Compliance" value={f.compliance} options={[{ value: "true", label: "Flagged calls only" }]} onChange={(v) => setF({ compliance: v as typeof f.compliance, page: null })} />}
            </PopoverContent>
          </Popover>
          <DateRangePicker />
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon" className="size-9" aria-label="Refresh" onClick={() => refetch()} />}>
              <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>
      )}

      {chips.length > 0 && !hideFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.label} onClick={c.clear} className="inline-flex h-7 items-center gap-1 rounded-full border bg-secondary px-3 text-xs hover:bg-accent">
              {c.label} <X className="size-3" />
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setF(Object.fromEntries(Object.keys(filterParsers).map((k) => [k, null]))); }}>Clear all</Button>
        </div>
      )}

      {!hideFilters && (
        <p className="text-sm text-muted-foreground tabular">
          {isLoading ? "Loading calls…" : total === 0 ? "No results" : `Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, total)} of ${total.toLocaleString("en-IN")} results`}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead s="agent" current={query.sort ?? "date"} order={query.order ?? "desc"} onSort={sortBy} className="pl-5">Agent</SortHead>
              {!compact && (!categoryId || categoryId === "all") && <TableHead>Category</TableHead>}
              <SortHead s="duration" current={query.sort ?? "date"} order={query.order ?? "desc"} onSort={sortBy}>Duration</SortHead>
              <SortHead s="score" current={query.sort ?? "date"} order={query.order ?? "desc"} onSort={sortBy}>Score</SortHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Status</TableHead>
              <SortHead s="date" current={query.sort ?? "date"} order={query.order ?? "desc"} onSort={sortBy}>Date</SortHead>
              {!compact && <TableHead>Uploaded by</TableHead>}
              <TableHead className="pr-5 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={9} className="px-5"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ))}
            {isError && (
              <TableRow><TableCell colSpan={9}><EmptyState title="Calls could not be loaded" description="The API returned an error. Try again." action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>} /></TableCell></TableRow>
            )}
            {data?.items.length === 0 && (
              <TableRow><TableCell colSpan={9}><EmptyState title="No calls match these filters" description="Try widening the date range or clearing a filter." /></TableCell></TableRow>
            )}
            {data?.items.map((c) => {
              const href = `/calls/${c.categoryId}/${c.id}`;
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(href)}>
                  <TableCell className="py-3 pl-5">
                    <div className="flex items-center gap-3">
                      <AgentAvatar name={c.agentName} size="sm" />
                      <div className="min-w-0">
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline">{c.agentName}</Link>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {c.id.replace("call_", "#")}
                          {c.complianceFlag && <span className="inline-flex items-center gap-0.5 text-danger" title="RBI compliance flag"><ShieldAlert className="size-3" /> flag</span>}
                          {c.reviewedAt && <span className="text-info">· reviewed</span>}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  {!compact && (!categoryId || categoryId === "all") && <TableCell className="max-w-44 truncate text-muted-foreground">{c.categoryName}</TableCell>}
                  <TableCell className="tabular text-muted-foreground">{fmtDuration(c.durationSec)}</TableCell>
                  <TableCell>{c.status === "done" ? <ScoreBadge score={c.isNotApplicable ? null : c.score} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><OutcomeBadge label={c.outcomeLabel} isSuccess={c.isSuccess} isNotApplicable={c.isNotApplicable} /></TableCell>
                  <TableCell><StatusBadge status={c.status} title={c.failureReason ?? undefined} /></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular">{fmtDate(c.callAt)}</TableCell>
                  {!compact && <TableCell className="text-muted-foreground">{c.uploadedByName ?? <span title="Ingested from the dialer integration">Dialer</span>}</TableCell>}
                  <TableCell className="pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="icon" className="size-8" aria-label="Copy call link" onClick={() => copyLink(c.id, c.categoryId)}><Link2 className="size-4" /></Button>
                      {c.audioUrl && c.status !== "failed" && (
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Download recording" nativeButton={false} render={<a href={c.audioUrl} download />}>
                          <Download className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {!compact && pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground tabular">Page {page} of {pages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setF({ page: page - 1 })}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setF({ page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
