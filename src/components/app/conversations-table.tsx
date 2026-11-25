"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Download, Filter, Link2, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversations, useWorkspace } from "@/lib/api-client";
import type { ListConversationsQuery } from "@/lib/contract";
import { DURATION_BUCKETS, SCORE_BUCKETS } from "@/lib/domain";
import { fmtDate, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AgentAvatar, EmptyState, OutcomeBadge, ScoreBadge, StatusBadge } from "./bits";
import { DateRangePicker } from "./date-range";

const SORTS = ["duration", "score", "date"] as const;
const STATUSES = ["completed", "processing", "queued", "failed", "skipped"] as const;
const filterParsers = {
  q: parseAsString,
  personId: parseAsString,
  cohortId: parseAsString,
  outcome: parseAsString,
  tag: parseAsString, // tag slug, any level of the hierarchy
  ext: parseAsString, // extracted value "field:value"
  status: parseAsStringLiteral(STATUSES),
  score: parseAsStringLiteral(Object.keys(SCORE_BUCKETS) as (keyof typeof SCORE_BUCKETS)[]),
  duration: parseAsStringLiteral(Object.keys(DURATION_BUCKETS) as (keyof typeof DURATION_BUCKETS)[]),
  audited: parseAsStringLiteral(["true", "false"] as const),
  riskFlag: parseAsStringLiteral(["true"] as const),
  needsReview: parseAsStringLiteral(["true"] as const),
  from: parseAsString,
  to: parseAsString,
  sort: parseAsStringLiteral(SORTS),
  order: parseAsStringLiteral(["asc", "desc"] as const),
};

type Opt = { value: string; label: string };
type SortKey = (typeof SORTS)[number];
const SORT_FIELD = { duration: "durationSec", score: "score", date: "occurredAt" } as const;
/** A table view: UI sort keys + filters, mapped onto the public list query. */
export type TableFilters = Partial<{ status: (typeof STATUSES)[number]; sort: SortKey; order: "asc" | "desc"; audited: "true" | "false"; riskFlag: "true"; needsReview: "true"; personId: string; from: string; to: string }>;

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

const STATUS_LABEL: Record<string, string> = { completed: "Analyzed", processing: "Processing", queued: "Queued", failed: "Failed", skipped: "Skipped" };

/**
 * The conversation list used across the app, on the public GET /api/v1/conversations (cursor pagination).
 * Filters live in the URL so every view is shareable; `fixed` filters are applied but not shown as chips.
 */
export function ConversationsTable({ categoryId, fixed, hideFilters, pageSize = 20, compact }: { categoryId?: string; fixed?: TableFilters; hideFilters?: boolean; pageSize?: number; compact?: boolean }) {
  const router = useRouter();
  const { data: ws } = useWorkspace();
  const [f, setF] = useQueryStates(filterParsers, { history: "replace" });
  const [search, setSearch] = useState(f.q ?? "");
  useEffect(() => {
    const t = setTimeout(() => { if ((f.q ?? "") !== search) setF({ q: search || null }); }, 300);
    return () => clearTimeout(t);
  }, [search, f.q, setF]);

  const v = { ...f, ...fixed };
  const sortKey: SortKey = v.sort ?? "date";
  const order = v.order ?? "desc";
  const score = v.score ? SCORE_BUCKETS[v.score] : null;
  const duration = v.duration ? DURATION_BUCKETS[v.duration] : null;
  const base: ListConversationsQuery = {
    categoryId: categoryId === "all" ? undefined : categoryId,
    q: v.q ?? undefined, personId: v.personId ?? undefined, cohortId: v.cohortId ?? undefined, outcome: v.outcome ?? undefined, tag: v.tag ?? undefined, ext: v.ext ?? undefined,
    status: v.status ?? undefined, scoreMin: score?.min, scoreMax: score?.max, durationMin: duration?.min, durationMax: duration && duration.max < 1e9 ? duration.max : undefined,
    audited: v.audited ?? undefined, riskFlag: v.riskFlag ?? undefined, needsReview: v.needsReview ?? undefined, from: v.from ?? undefined, to: v.to ?? undefined,
    sort: `${order === "desc" ? "-" : ""}${SORT_FIELD[sortKey]}` as ListConversationsQuery["sort"],
    limit: pageSize, includeTotal: "true",
  };
  // stack of cursors for the pages before this one; any filter change starts again at page 1
  const key = JSON.stringify(base);
  const [pager, setPager] = useState<{ key: string; cursors: string[] }>({ key, cursors: [] });
  const cursors = pager.key === key ? pager.cursors : [];
  const setCursors = (fn: (c: string[]) => string[]) => setPager({ key, cursors: fn(cursors) });
  const cursor = cursors.at(-1);
  const { data, isLoading, isFetching, refetch, isError } = useConversations({ ...base, cursor });
  const isMember = ws?.me.role === "member";

  const outcomeOptions = useMemo(() => {
    const cats = ws?.categories.filter((c) => !categoryId || categoryId === "all" || c.id === categoryId) ?? [];
    return [...new Set(cats.flatMap((c) => c.rubric.outcomes.map((o) => o.label)))].map((l) => ({ value: l, label: l }));
  }, [ws, categoryId]);
  const tagPath = (slug: string) => slug.split("/").map((_, i, a) => ws?.tags.find((x) => x.slug === a.slice(0, i + 1).join("/"))?.displayName ?? a[i]).join(" › ");
  const tagOptions = [...(ws?.tags ?? [])].sort((a, b) => a.slug.localeCompare(b.slug)).map((x) => ({ value: x.slug, label: `${"  ".repeat(x.slug.split("/").length - 1)}${x.slug.includes("/") ? "› " : ""}${x.displayName}` }));
  const name = (list: { id: string; name: string }[] | undefined, id: string | null) => list?.find((x) => x.id === id)?.name ?? id;

  const chips: { label: string; clear: () => void }[] = [];
  if (f.personId) chips.push({ label: `Person: ${name(ws?.people, f.personId)}`, clear: () => setF({ personId: null }) });
  if (f.cohortId) chips.push({ label: `Cohort: ${name(ws?.cohorts, f.cohortId)}`, clear: () => setF({ cohortId: null }) });
  if (f.outcome) chips.push({ label: `Outcome: ${f.outcome}`, clear: () => setF({ outcome: null }) });
  if (f.status) chips.push({ label: `Status: ${STATUS_LABEL[f.status]}`, clear: () => setF({ status: null }) });
  if (f.score) chips.push({ label: `Score: ${SCORE_BUCKETS[f.score].label}`, clear: () => setF({ score: null }) });
  if (f.duration) chips.push({ label: `Duration: ${DURATION_BUCKETS[f.duration].label}`, clear: () => setF({ duration: null }) });
  if (f.tag) chips.push({ label: `Tag: ${tagPath(f.tag)}${ws?.tags.some((x) => x.slug.startsWith(`${f.tag}/`)) ? " (all)" : ""}`, clear: () => setF({ tag: null }) });
  if (f.ext) {
    const [field, ...rest] = f.ext.split(":");
    const def = ws?.categories.flatMap((c) => c.rubric.extractionFields).find((x) => x.fieldName === field);
    chips.push({ label: `${def?.displayName ?? field}: ${rest.join(":").replace(/_/g, " ")}`, clear: () => setF({ ext: null }) });
  }
  if (f.audited) chips.push({ label: f.audited === "true" ? "Audited" : "Not audited", clear: () => setF({ audited: null }) });
  if (f.riskFlag) chips.push({ label: "Risk flagged", clear: () => setF({ riskFlag: null }) });
  if (f.from && f.to) chips.push({ label: `${fmtDate(f.from)} – ${fmtDate(f.to)}`, clear: () => setF({ from: null, to: null }) });

  const sortBy = (s: SortKey) => setF({ sort: s, order: sortKey === s && order === "desc" ? "asc" : "desc" });
  const copyLink = (id: string, cat: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/conversations/${cat}/${id}`).then(() => toast.success("Conversation link copied"), () => toast.error("Could not copy the link"));
  };
  const total = data?.total ?? 0;
  const page = cursors.length + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      {!hideFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isMember ? "Search by conversation or external ID…" : "Search by person, conversation or external ID…"} className="h-9 pl-9" aria-label="Search conversations" />
          </div>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" className="h-9 gap-2" />}>
              <Filter className="size-4" /> Filters
              {chips.length > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular">{chips.length}</span>}
            </PopoverTrigger>
            <PopoverContent align="start" className="grid w-[min(92vw,560px)] grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              {!isMember && <FilterSelect label="Person" value={f.personId} options={(ws?.people ?? []).map((a) => ({ value: a.id, label: a.name }))} onChange={(x) => setF({ personId: x })} />}
              {!isMember && <FilterSelect label="Cohort" value={f.cohortId} options={(ws?.cohorts ?? []).map((t) => ({ value: t.id, label: t.name }))} onChange={(x) => setF({ cohortId: x })} />}
              <FilterSelect label="Outcome" value={f.outcome} options={outcomeOptions} onChange={(x) => setF({ outcome: x })} />
              <FilterSelect label="Status" value={f.status} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} onChange={(x) => setF({ status: x as typeof f.status })} />
              <FilterSelect label="Quality score" value={f.score} options={Object.entries(SCORE_BUCKETS).map(([k, b]) => ({ value: k, label: b.label }))} onChange={(x) => setF({ score: x as typeof f.score })} />
              <FilterSelect label="Duration" value={f.duration} options={Object.entries(DURATION_BUCKETS).map(([k, b]) => ({ value: k, label: b.label }))} onChange={(x) => setF({ duration: x as typeof f.duration })} />
              <FilterSelect label="Tag (any level)" value={f.tag} options={tagOptions} onChange={(x) => setF({ tag: x })} />
              {!fixed?.audited && <FilterSelect label="Audit" value={f.audited} options={[{ value: "true", label: "Audited" }, { value: "false", label: "Not audited" }]} onChange={(x) => setF({ audited: x as typeof f.audited })} />}
              {!fixed?.riskFlag && <FilterSelect label="Risk flags" value={f.riskFlag} options={[{ value: "true", label: "Flagged conversations only" }]} onChange={(x) => setF({ riskFlag: x as typeof f.riskFlag })} />}
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
          {isLoading ? "Loading conversations…" : total === 0 ? "No results" : `Showing ${(page - 1) * pageSize + 1} to ${Math.min((page - 1) * pageSize + rows.length, total)} of ${total.toLocaleString("en-IN")} results`}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Person</TableHead>
              {!compact && (!categoryId || categoryId === "all") && <TableHead>Category</TableHead>}
              <SortHead s="duration" current={sortKey} order={order} onSort={sortBy}>Duration</SortHead>
              <SortHead s="score" current={sortKey} order={order} onSort={sortBy}>Score</SortHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Status</TableHead>
              <SortHead s="date" current={sortKey} order={order} onSort={sortBy}>Date</SortHead>
              {!compact && <TableHead>Source</TableHead>}
              <TableHead className="pr-5 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={9} className="px-5"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ))}
            {isError && (
              <TableRow><TableCell colSpan={9}><EmptyState title="Conversations could not be loaded" description="The API returned an error. Try again." action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>} /></TableCell></TableRow>
            )}
            {data && rows.length === 0 && (
              <TableRow><TableCell colSpan={9}><EmptyState title="No conversations match these filters" description="Try widening the date range or clearing a filter." /></TableCell></TableRow>
            )}
            {rows.map((c) => {
              const href = `/conversations/${c.categoryId}/${c.id}`;
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(href)}>
                  <TableCell className="py-3 pl-5">
                    <div className="flex items-center gap-3">
                      <AgentAvatar name={c.person.name} size="sm" />
                      <div className="min-w-0">
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="block truncate font-medium hover:underline">{c.person.name}</Link>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {c.externalId ?? c.id.replace("conv_", "#")}
                          {c.riskFlag && <span className="inline-flex items-center gap-0.5 text-danger" title="Risk flag"><ShieldAlert className="size-3" /> flag</span>}
                          {c.audit && <span className="text-info">· audited</span>}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  {!compact && (!categoryId || categoryId === "all") && <TableCell className="max-w-44 truncate text-muted-foreground">{ws?.categories.find((x) => x.id === c.categoryId)?.name ?? c.categoryId}</TableCell>}
                  <TableCell className="tabular text-muted-foreground">{c.audio.durationSec ? fmtDuration(c.audio.durationSec) : "—"}</TableCell>
                  <TableCell>{c.status === "completed" ? <ScoreBadge score={c.score} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><OutcomeBadge label={c.outcome?.label ?? null} isSuccess={c.outcome ? c.outcome.type === "success" : null} isNotApplicable={c.outcome ? c.outcome.type === "na" : null} /></TableCell>
                  <TableCell><StatusBadge status={c.status} stage={c.stage} title={c.failure?.message} /></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular">{fmtDate(c.occurredAt)}</TableCell>
                  {!compact && <TableCell className="text-muted-foreground">{c.externalId ? <span title="Submitted through the API">API</span> : "Upload"}</TableCell>}
                  <TableCell className="pr-5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      <Button variant="ghost" size="icon" className="size-8" aria-label="Copy conversation link" onClick={() => copyLink(c.id, c.categoryId)}><Link2 className="size-4" /></Button>
                      {c.audio.playbackUrl && (
                        <Button variant="ghost" size="icon" className="size-8" aria-label="Download recording" nativeButton={false} render={<a href={c.audio.playbackUrl} download />}>
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
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={!data?.nextCursor} onClick={() => data?.nextCursor && setCursors((c) => [...c, data.nextCursor!])}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
