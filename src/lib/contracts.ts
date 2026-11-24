import { z } from "zod";
import { DURATION_BUCKETS, SCORE_BUCKETS } from "./domain";

const list = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : v.split(",")).filter(Boolean));

export const listCallsQuery = z.object({
  categoryId: z.string().optional(),
  agentId: list.optional(),
  teamId: list.optional(),
  outcome: list.optional(), // outcome labels
  tag: list.optional(),
  status: z.enum(["all", "done", "processing", "failed"]).default("all"),
  scoreBucket: z.enum(Object.keys(SCORE_BUCKETS) as [keyof typeof SCORE_BUCKETS]).optional(),
  durationBucket: z.enum(Object.keys(DURATION_BUCKETS) as [keyof typeof DURATION_BUCKETS]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  q: z.string().trim().optional(),
  reviewed: z.enum(["true", "false"]).optional(),
  compliance: z.enum(["true"]).optional(),
  sort: z.enum(["agent", "duration", "score", "date"]).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCallsQuery = z.input<typeof listCallsQuery>;

export const createCallBody = z.object({
  categoryId: z.string(),
  agentId: z.string(),
  sampleId: z.string().optional(),
  audioUrl: z.string().url().optional(),
  durationSec: z.coerce.number().int().min(1).max(4 * 3600).optional(),
  callAt: z.string().datetime({ offset: true }).optional(),
  udfs: z.record(z.string(), z.unknown()).optional(),
});

export const reviewBody = z.object({
  overrides: z.array(z.object({ criterionId: z.string(), result: z.enum(["pass", "fail", "na"]).nullable() })).default([]),
  note: z.string().max(4000).optional(),
  tagIds: z.array(z.string()).optional(),
});
export type ReviewBody = z.input<typeof reviewBody>;

export const analyticsQuery = z.object({
  dimension: z.enum(["org", "category", "team", "agent"]).default("org"),
  id: z.string().optional(),
  categoryId: z.string().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type AnalyticsQuery = z.input<typeof analyticsQuery>;
