import { z } from "zod";
import * as c from "@/lib/contract";

/**
 * OpenAPI 3.1 document generated from the zod contract, so the spec can never drift from validation.
 * Served at /api/v1/openapi.json and rendered at /docs/api.
 */
type Op = {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  summary: string;
  description?: string;
  tag: string;
  query?: z.ZodObject;
  body?: z.ZodType;
  ok: { status: number; schema?: z.ZodType; description: string }[];
  scope?: "read" | "write";
};

const conversationList = c.listOf(c.conversationObject);
const OPS: Op[] = [
  { method: "post", path: "/uploads", tag: "Uploads", summary: "Get a presigned URL for a direct upload", description: "PUT the file to `uploadUrl` (with the returned headers), then pass `audioUrl` to POST /conversations. Optional: callers with their own recording URL skip this.", body: c.createUploadBody, ok: [{ status: 201, schema: c.uploadObject, description: "Upload URL" }] },
  { method: "post", path: "/conversations", tag: "Conversations", summary: "Submit a recording for analysis", description: "Returns the conversation at status `queued`. With an `externalId` that already exists, returns the existing conversation with 200 and `Idempotent-Replayed: true`, so retries are safe. The person is matched by externalId, then email, and created if missing.", body: c.createConversationBody, ok: [{ status: 202, schema: c.conversationObject, description: "Accepted" }, { status: 200, schema: c.conversationObject, description: "Replayed (externalId already submitted)" }] },
  { method: "get", path: "/conversations", tag: "Conversations", summary: "List, filter and sync conversations", description: "Cursor-paginated. For warehouse sync pass `updatedSince`: results come oldest change first and include deletion tombstones. Transcripts are omitted; fetch a conversation for its transcript.", query: c.listConversationsQuery, ok: [{ status: 200, schema: conversationList, description: "A page of conversations" }] },
  { method: "get", path: "/conversations/{id}", tag: "Conversations", summary: "Get a conversation", description: "`{id}` also accepts `ext:<externalId>`.", ok: [{ status: 200, schema: c.conversationObject, description: "The full conversation, transcript included" }] },
  { method: "delete", path: "/conversations/{id}", tag: "Conversations", summary: "Erase a conversation", description: "Deletes audio, transcript and analysis (right to erasure). A tombstone (id, externalId, deletedAt) remains so syncs see the deletion.", ok: [{ status: 204, description: "Erased" }] },
  { method: "post", path: "/conversations/{id}/analyze", tag: "Conversations", summary: "Re-analyse, or dry-run a draft rubric", description: "Re-scores with the current (or a chosen) rubric version, reusing the transcript (no ASR cost): 202. A failed conversation without a transcript restarts from ingest. With `dryRun: true` (optionally with a draft `rubric`) the result is returned (200) and nothing is saved.", body: c.analyzeBody, ok: [{ status: 202, schema: c.conversationObject, description: "Re-analysis started" }, { status: 200, description: "Dry-run result" }] },
  { method: "patch", path: "/conversations/{id}/scorecard", tag: "Conversations", summary: "Audit a scorecard", description: "Override criterion answers, the outcome and manual tags; the score is recomputed and the AI answer kept. Emits `conversation.updated`. Overrides feed the `agreement` metric.", body: c.scorecardPatchBody, ok: [{ status: 200, schema: c.conversationObject, description: "The audited conversation" }] },
  { method: "get", path: "/categories", tag: "Categories", summary: "List categories", ok: [{ status: 200, schema: c.listOf(c.categoryObject), description: "Categories with their current rubric" }] },
  { method: "get", path: "/categories/{id}", tag: "Categories", summary: "Get a category", description: "`?version=n` reads an older published rubric.", ok: [{ status: 200, schema: c.categoryObject, description: "The category" }] },
  { method: "put", path: "/categories/{id}", tag: "Categories", summary: "Create a category or publish a rubric version", description: "The full category document (config-as-code friendly). Validated: unique ids, rules that evaluate and point at real targets, known tags. Each change publishes a new immutable version; an identical document is a no-op. Admin only.", body: c.categoryBody, ok: [{ status: 201, schema: c.categoryObject, description: "Created" }, { status: 200, schema: c.categoryObject, description: "Published (or unchanged)" }] },
  { method: "get", path: "/people", tag: "People", summary: "List people", query: c.listPeopleQuery, ok: [{ status: 200, schema: c.listOf(c.personObject), description: "A page of people" }] },
  { method: "post", path: "/people", tag: "People", summary: "Create or match a person", description: "Upserts on externalId, then email.", body: c.personBody, ok: [{ status: 201, schema: c.personObject, description: "Created" }, { status: 200, schema: c.personObject, description: "Matched an existing person" }] },
  { method: "get", path: "/people/{id}", tag: "People", summary: "Get a person", description: "`{id}` also accepts `ext:<externalId>`.", ok: [{ status: 200, schema: c.personObject, description: "The person" }] },
  { method: "patch", path: "/people/{id}", tag: "People", summary: "Update or deactivate a person", description: "`active: false` deactivates; history stays.", body: c.personPatchBody, ok: [{ status: 200, schema: c.personObject, description: "The person" }] },
  { method: "get", path: "/cohorts", tag: "Cohorts", summary: "List cohorts", ok: [{ status: 200, schema: c.listOf(c.cohortObject), description: "Cohorts" }] },
  { method: "post", path: "/cohorts", tag: "Cohorts", summary: "Create a cohort", description: "`language` is the default ASR hint for its people.", body: c.cohortBody, ok: [{ status: 201, schema: c.cohortObject, description: "Created" }] },
  { method: "patch", path: "/cohorts/{id}", tag: "Cohorts", summary: "Update a cohort", body: c.cohortBody.partial(), ok: [{ status: 200, schema: c.cohortObject, description: "The cohort" }] },
  { method: "get", path: "/tags", tag: "Tags", summary: "List the tag taxonomy", description: "`?prefix=objection` returns a subtree.", ok: [{ status: 200, schema: c.listOf(c.tagObject), description: "Tags" }] },
  { method: "put", path: "/tags/{slug}", tag: "Tags", summary: "Create or update a tag", description: "The slug is a path (`objection/financial/medical`); missing parents are created.", body: c.tagBody, ok: [{ status: 200, schema: c.tagObject, description: "The tag" }] },
  { method: "get", path: "/analytics", tag: "Analytics", summary: "Aggregate metrics", description: "`metrics` × `groupBy` over completed conversations. `agreement` is AI–auditor agreement on audited conversations; `passRate` is the share of applicable criteria answered yes.", query: c.analyticsQuery, ok: [{ status: 200, schema: c.analyticsObject, description: "One row per group" }] },
  { method: "get", path: "/webhooks", tag: "Webhooks", summary: "List webhook endpoints", ok: [{ status: 200, schema: c.listOf(c.webhookObject), description: "Endpoints" }] },
  { method: "post", path: "/webhooks", tag: "Webhooks", summary: "Subscribe an endpoint", description: "Deliveries are signed per the Standard Webhooks spec (`webhook-id`, `webhook-timestamp`, `webhook-signature`). The secret is returned once. Failed deliveries retry with backoff (8 attempts over ~2 h); an endpoint failing for 3 days is disabled.", body: c.webhookBody, ok: [{ status: 201, schema: c.webhookObject, description: "Created (includes `secret`)" }] },
  { method: "delete", path: "/webhooks/{id}", tag: "Webhooks", summary: "Remove an endpoint", ok: [{ status: 204, description: "Removed" }] },
];

const json = (s: z.ZodType, io: "input" | "output") => z.toJSONSchema(s, { io, unrepresentable: "any", target: "openapi-3.0" }) as Record<string, unknown>;

export function openApiDocument(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [
      ...[...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } })),
      ...(op.query ? Object.entries((json(op.query, "input").properties ?? {}) as Record<string, Record<string, unknown>>).map(([name, schema]) => ({ name, in: "query", required: false, schema, ...(schema.description ? { description: schema.description } : {}) })) : []),
    ];
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      operationId: `${op.method}${op.path.replace(/[{}]/g, "").split("/").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("")}`,
      ...(params.length ? { parameters: params } : {}),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: json(op.body, "input") } } } } : {}),
      responses: {
        ...Object.fromEntries(op.ok.map((r) => [String(r.status), { description: r.description, ...(r.schema ? { content: { "application/json": { schema: json(r.schema, "output") } } } : {}) }])),
        default: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Conversation analytics API",
      version: "1.0.0",
      description: "Submit call recordings, get evidence-backed scorecards back. Additive changes only within v1: ignore fields you don't know.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key from Workspace → Integrations. Read-only keys can only GET." } },
      schemas: { Error: json(c.errorObject, "output"), Conversation: json(c.conversationObject, "output"), Event: json(c.eventObject, "output") },
    },
    paths,
  };
}

export const OPERATIONS = OPS.map(({ method, path, summary, description, tag }) => ({ method: method.toUpperCase(), path, summary, description, tag }));
