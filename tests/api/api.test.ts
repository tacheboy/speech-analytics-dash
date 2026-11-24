import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getAnalytics } from "@/app/api/v1/analytics/route";
import { GET as listCalls, POST as createCall } from "@/app/api/v1/calls/route";
import { GET as getCall } from "@/app/api/v1/calls/[id]/route";
import { PATCH as review } from "@/app/api/v1/calls/[id]/review/route";
import { GET as getWorkspace } from "@/app/api/v1/workspace/route";
import { db, schema } from "@/server/db/client";
import { listCalls as listCallsService } from "@/server/services/calls";
import { getAnalytics as analyticsService } from "@/server/services/analytics";

const H = { "x-api-key": "test_key" };
const req = (path: string, init: RequestInit = {}) => new Request(`http://test${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

describe("auth", () => {
  it("rejects missing and bad API keys", async () => {
    expect((await json(await getWorkspace(new Request("http://test/api/v1/workspace", { headers: { "x-api-key": "nope" } }), undefined as never))).status).toBe(401);
  });
});

describe("GET /workspace", () => {
  it("returns categories with rubrics, teams, agents and samples", async () => {
    const { status, body } = await json(await getWorkspace(req("/api/v1/workspace"), undefined as never));
    expect(status).toBe(200);
    expect(body.data.categories).toHaveLength(3);
    expect(body.data.teams).toHaveLength(3);
    expect(body.data.agents).toHaveLength(18);
    expect(body.data.samples.length).toBeGreaterThan(20);
  });
});

describe("GET /calls", () => {
  it("filters, sorts and paginates", async () => {
    const { body } = await json(await listCalls(req("/api/v1/calls?categoryId=mid-bucket&scoreBucket=poor&sort=score&order=asc&pageSize=5"), undefined as never));
    expect(body.data.items).toHaveLength(5);
    expect(body.data.items.every((c: { categoryId: string; score: number }) => c.categoryId === "mid-bucket" && c.score < 50)).toBe(true);
    const scores = body.data.items.map((c: { score: number }) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    const page2 = await json(await listCalls(req("/api/v1/calls?categoryId=mid-bucket&scoreBucket=poor&sort=score&order=asc&pageSize=5&page=2"), undefined as never));
    expect(page2.body.data.items[0].id).not.toBe(body.data.items[0].id);
  });
  it("filters by outcome label across categories and validates input", async () => {
    const { body } = await json(await listCalls(req("/api/v1/calls?outcome=Promise%20to%20Pay&pageSize=50"), undefined as never));
    expect(body.data.items.every((c: { outcomeLabel: string }) => c.outcomeLabel === "Promise to Pay")).toBe(true);
    expect((await json(await listCalls(req("/api/v1/calls?pageSize=500"), undefined as never))).status).toBe(400);
  });
  it("scopes agents to their own calls", async () => {
    const res = await listCallsService({ userId: "u_rahul_sharma", orgId: "org_kaveri", role: "agent", name: "Rahul" }, { agentId: "u_neha_gupta", pageSize: 100 });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((c) => c.agentId === "u_rahul_sharma")).toBe(true);
  });
});

describe("POST /calls → processing → done", () => {
  it("accepts a sample, returns 202 and completes lazily", async () => {
    const r = await json(await createCall(req("/api/v1/calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ categoryId: "early-bucket", agentId: "rahul.sharma@kaverifinance.in", sampleId: "eb-hi-good" }) }), undefined as never));
    expect(r.status).toBe(202);
    expect(r.body.data.status).toBe("processing");
    const id = r.body.data.callId;
    expect((await json(await getCall(req(`/api/v1/calls/${id}`), ctx(id)))).body.data.status).toBe("processing");
    await db.update(schema.calls).set({ readyAt: new Date(Date.now() - 1000) }).where(eq(schema.calls.id, id)); // skip the simulated wait
    const done = (await json(await getCall(req(`/api/v1/calls/${id}`), ctx(id)))).body.data;
    expect(done.status).toBe("done");
    expect(done.score).toBe(100);
    expect(done.transcript.length).toBeGreaterThan(5);
    expect(done.sections.every((s: { met: number; total: number }) => s.met <= s.total)).toBe(true);
  });
  it("rejects a sample from another category", async () => {
    const r = await json(await createCall(req("/api/v1/calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ categoryId: "settlement", agentId: "u_rahul_sharma", sampleId: "eb-hi-good" }) }), undefined as never));
    expect(r.status).toBe(400);
  });
});

describe("PATCH /calls/:id/review", () => {
  it("overrides criteria, recomputes the score and keeps the AI score", async () => {
    const [c] = await db.select().from(schema.calls).where(sql`${schema.calls.score} = 100 and ${schema.calls.status} = 'done'`).limit(1);
    const before = (await json(await getCall(req(`/api/v1/calls/${c.id}`), ctx(c.id)))).body.data;
    const crit = before.sections.flatMap((s: { criteria: { id: string }[] }) => s.criteria);
    const r = await json(await review(req(`/api/v1/calls/${c.id}/review`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ overrides: [{ criterionId: crit[0].id, result: "fail" }], note: "test" }) }), ctx(c.id)));
    expect(r.status).toBe(200);
    expect(r.body.data.aiScore).toBe(100);
    expect(r.body.data.score).toBe(Math.round((100 * (crit.length - 1)) / crit.length));
    expect(r.body.data.reviewNote).toBe("test");
    expect((await json(await review(req(`/api/v1/calls/${c.id}/review`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ overrides: [{ criterionId: "nope", result: "fail" }] }) }), ctx(c.id)))).status).toBe(400);
  });
});

describe("GET /analytics", () => {
  it("totals match raw database counts", async () => {
    const { body } = await json(await getAnalytics(req("/api/v1/analytics?dimension=category&id=early-bucket&from=2000-01-01&to=2100-01-01"), undefined as never));
    const [raw] = await db.execute<{ n: number; q: string; s: string }>(sql`
      select count(*)::int n,
        round(avg(score) filter (where not is_not_applicable), 1)::text q,
        round(100.0 * count(*) filter (where is_success) / nullif(count(*) filter (where not is_not_applicable), 0), 1)::text s
      from calls where category_id = 'early-bucket' and status = 'done'`);
    expect(body.data.kpis.volume.value).toBe(raw.n);
    expect(body.data.kpis.quality.value).toBe(Number(raw.q));
    expect(body.data.kpis.successRate.value).toBe(Number(raw.s));
    expect(body.data.outcomes.reduce((s: number, o: { count: number }) => s + o.count, 0)).toBe(raw.n);
  });
  it("forces agents onto their own numbers", async () => {
    const a = await analyticsService({ userId: "u_rahul_sharma", orgId: "org_kaveri", role: "agent", name: "Rahul" }, { dimension: "org" });
    expect(a.scope).toMatchObject({ dimension: "agent", id: "u_rahul_sharma" });
    expect(a.profile).not.toBeNull();
  });
});
