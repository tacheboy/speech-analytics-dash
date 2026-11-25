import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getAnalytics } from "@/app/api/v1/analytics/route";
import { GET as getCategory, PUT as putCategory } from "@/app/api/v1/categories/[id]/route";
import { GET as listCategories } from "@/app/api/v1/categories/route";
import { POST as createCohort } from "@/app/api/v1/cohorts/route";
import { POST as analyze } from "@/app/api/v1/conversations/[id]/analyze/route";
import { DELETE as deleteConversation, GET as getConversation } from "@/app/api/v1/conversations/[id]/route";
import { PATCH as patchScorecard } from "@/app/api/v1/conversations/[id]/scorecard/route";
import { GET as listConversations, POST as createConversation } from "@/app/api/v1/conversations/route";
import { GET as openapi } from "@/app/api/v1/openapi.json/route";
import { GET as getPerson, PATCH as patchPerson } from "@/app/api/v1/people/[id]/route";
import { POST as createPerson } from "@/app/api/v1/people/route";
import { PUT as putTag } from "@/app/api/v1/tags/[...slug]/route";
import { POST as createUpload } from "@/app/api/v1/uploads/route";
import { POST as createWebhook } from "@/app/api/v1/webhooks/route";
import { PUT as putFile, GET as getFile } from "@/app/api/files/[...key]/route";
import type { Conversation } from "@/lib/contract";
import { db, schema } from "@/server/db/client";
import { startWorker, stopWorker } from "@/server/pipeline/worker";
import { json, localServer, none, params, req, toneMp3, uniq, waitFor } from "./helpers";

const C = "/api/v1/conversations";
async function newKey(scope: "read" | "write" = "write", orgId = "org_kaveri") {
  const { generateApiKey } = await import("@/server/external/auth");
  const g = generateApiKey();
  await db.insert(schema.apiKeys).values({ id: `key_${uniq()}`, orgId, name: "test", scope, prefix: g.prefix, hash: g.hash });
  return { authorization: `Bearer ${g.key}` };
}
const get = async (id: string) => (await json(await getConversation(req(`${C}/${id}`), params({ id })))).body as Conversation;
const settled = (c: Conversation) => !["queued", "processing"].includes(c.status);
const submit = async (body: Record<string, unknown>) => json(await createConversation(req(C, { method: "POST", json: body }), none));
const sample = (extra: Record<string, unknown> = {}) => ({ categoryId: "early-bucket", personId: "per_rahul_sharma", sampleId: "eb-hi-good", ...extra });

let hooks: Awaited<ReturnType<typeof localServer>>;
let webhookSecret: string;
const tone = toneMp3(25);

beforeAll(async () => {
  await startWorker();
  hooks = await localServer(tone);
  const w = await json(await createWebhook(req("/api/v1/webhooks", { method: "POST", json: { url: `${hooks.url}/hook`, events: ["conversation.completed", "conversation.failed", "conversation.updated"] } }), none));
  expect(w.status).toBe(201);
  webhookSecret = w.body.secret;
}, 60_000);

afterAll(async () => {
  await stopWorker();
  await hooks.close();
});

describe("the integration loop", () => {
  let id: string;
  const externalId = `EXO-${uniq()}`;

  it("POST /conversations → 202 queued → completed with a verified, evidence-backed scorecard", async () => {
    const r = await submit(sample({ externalId, metadata: { loanId: "LN-1" } }));
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ object: "conversation", externalId, status: "queued", person: { id: "per_rahul_sharma" }, metadata: { loanId: "LN-1" } });
    id = r.body.id;
    expect(id).toMatch(/^conv_/);

    const c = await waitFor(() => get(id), settled);
    expect(c.status).toBe("completed");
    expect(c.failure).toBeNull();
    expect(c.transcript!.length).toBeGreaterThan(5);
    expect(c.transcript!.every((s) => ["person", "customer"].includes(s.speaker))).toBe(true);
    expect(c.audio).toMatchObject({ channels: 2 });
    expect(c.audio.durationSec).toBeGreaterThan(10);
    expect(c.audio.playbackUrl).toContain("/api/files/");
    expect(c.analysis).toMatchObject({ models: { asr: "mock:replay", llm: "mock:replay" }, simulated: false });
    expect(c.score).toBeGreaterThan(0);
    const answered = c.scorecard!.flatMap((s) => s.criteria).filter((x) => x.result !== "na");
    expect(answered.length).toBeGreaterThan(5);
    expect(answered.every((x) => x.evidence?.verified)).toBe(true);
    expect(c.outcome).toMatchObject({ type: expect.stringMatching(/success|standard|na/) });
  }, 60_000);

  it("re-posting the same externalId returns the same conversation (200, Idempotent-Replayed)", async () => {
    const r = await submit(sample({ externalId }));
    expect(r.status).toBe(200);
    expect(r.headers.get("idempotent-replayed")).toBe("true");
    expect(r.body.id).toBe(id);
  });

  it("addresses conversations by ext:<externalId>", async () => {
    expect((await get(`ext:${externalId}`)).id).toBe(id);
  });

  it("delivers conversation.completed, signed per Standard Webhooks", async () => {
    const hit = await waitFor(async () => hooks.received.find((h) => JSON.parse(h.body).data?.conversation?.id === id && JSON.parse(h.body).type === "conversation.completed"), Boolean, 20_000);
    const { "webhook-id": wid, "webhook-timestamp": ts, "webhook-signature": sig } = hit!.headers as Record<string, string>;
    const expected = createHmac("sha256", Buffer.from(webhookSecret.replace("whsec_", ""), "base64")).update(`${wid}.${ts}.${hit!.body}`).digest("base64");
    expect(sig).toBe(`v1,${expected}`);
    const evt = JSON.parse(hit!.body);
    expect(evt.id).toMatch(/^evt_/);
    expect(evt.data.conversation.transcript).toBeUndefined();
  }, 30_000);

  it("PATCH /scorecard overrides an answer, keeps the AI answer, recomputes and emits conversation.updated", async () => {
    const before = await get(id);
    const target = before.scorecard!.flatMap((s) => s.criteria).find((x) => x.result === "yes")!;
    const r = await json(await patchScorecard(req(`${C}/${id}/scorecard`, { method: "PATCH", json: { overrides: [{ criterionId: target.criterionId, result: "no" }], note: "coached" } }), params({ id })));
    expect(r.status).toBe(200);
    const after: Conversation = r.body;
    const crit = after.scorecard!.flatMap((s) => s.criteria).find((x) => x.criterionId === target.criterionId)!;
    expect(crit).toMatchObject({ result: "no", aiResult: "yes", source: "audit" });
    expect(after.score!).toBeLessThan(before.score!);
    expect(after.aiScore).toBe(before.aiScore);
    expect(after.audit).toMatchObject({ note: "coached" });
    await waitFor(async () => hooks.received.some((h) => JSON.parse(h.body).type === "conversation.updated" && JSON.parse(h.body).data.conversation.id === id), Boolean, 20_000);
  }, 30_000);

  it("dry-runs a draft rubric without saving, then re-analyses for real (overrides survive)", async () => {
    const cat = (await json(await getCategory(req("/api/v1/categories/early-bucket"), params({ id: "early-bucket" })))).body;
    const { object: _o, id: _i, version: _v, versions: _vs, createdAt: _c, updatedAt: _u, ...doc } = cat;
    const draft = { ...doc, sections: doc.sections.slice(1) };
    const dry = await json(await analyze(req(`${C}/${id}/analyze`, { method: "POST", json: { dryRun: true, rubric: draft } }), params({ id })));
    expect(dry.status).toBe(200);
    expect(dry.body.object).toBe("dry_run");
    expect(dry.body.scorecard.map((s: { sectionId: string }) => s.sectionId)).not.toContain(doc.sections[0].id);
    expect((await get(id)).scorecard!.map((s) => s.sectionId)).toContain(doc.sections[0].id); // nothing saved

    const re = await json(await analyze(req(`${C}/${id}/analyze`, { method: "POST", json: {} }), params({ id })));
    expect(re.status).toBe(202);
    const done = await waitFor(() => get(id), (c) => c.status === "completed" && c.analysis!.id !== re.body.analysis?.id);
    expect(done.scorecard!.flatMap((s) => s.criteria).some((x) => x.source === "audit")).toBe(true);
  }, 60_000);
});

describe("uploads and failures", () => {
  it("POST /uploads → PUT → POST /conversations with the audioUrl (mock analysis is flagged simulated)", async () => {
    const up = await json(await createUpload(req("/api/v1/uploads", { method: "POST", json: { fileName: "Call 1.mp3", contentType: "audio/mpeg" } }), none));
    expect(up.status).toBe(201);
    const key = new URL(up.body.uploadUrl).pathname.replace("/api/files/", "").split("/");
    const put = await putFile(new Request(up.body.uploadUrl, { method: "PUT", body: new Uint8Array(tone), headers: up.body.headers }), params({ key }));
    expect(put.status).toBe(200);
    expect((await getFile(new Request(up.body.audioUrl), params({ key }))).status).toBe(200);
    const bad = await putFile(new Request(up.body.uploadUrl.replace(/sig=\w/, "sig=0"), { method: "PUT", body: "x" }), params({ key }));
    expect(bad.status).toBe(403);

    const r = await submit({ categoryId: "mid-bucket", person: { externalId: `AGT-${uniq()}`, name: "New Hire", email: `new.${uniq()}@example.com` }, audioUrl: up.body.audioUrl });
    expect(r.status).toBe(202);
    expect(r.body.person.name).toBe("New Hire");
    const c = await waitFor(() => get(r.body.id), settled);
    expect(c.status).toBe("completed");
    expect(c.audio.durationSec).toBe(25);
    expect(c.analysis!.simulated).toBe(true);
  }, 60_000);

  it("fetches remote URLs; a 404 fails fast with audio_forbidden (not retryable)", async () => {
    const r = await submit(sample({ sampleId: undefined, audioUrl: `${hooks.url}/missing.mp3` }));
    const c = await waitFor(() => get(r.body.id), settled);
    expect(c).toMatchObject({ status: "failed", failure: { code: "audio_forbidden", stage: "ingesting", retryable: false } });
    const ok = await submit(sample({ sampleId: undefined, audioUrl: `${hooks.url}/audio.mp3` }));
    expect((await waitFor(() => get(ok.body.id), settled)).status).toBe("completed");
  }, 60_000);

  it("skips recordings shorter than the org minimum (status skipped, too_short)", async () => {
    const up = await json(await createUpload(req("/api/v1/uploads", { method: "POST", json: { fileName: "short.mp3", contentType: "audio/mpeg" } }), none));
    const key = new URL(up.body.uploadUrl).pathname.replace("/api/files/", "").split("/");
    await putFile(new Request(up.body.uploadUrl, { method: "PUT", body: new Uint8Array(toneMp3(3)) }), params({ key }));
    const r = await submit(sample({ sampleId: undefined, audioUrl: up.body.audioUrl }));
    const c = await waitFor(() => get(r.body.id), settled);
    expect(c).toMatchObject({ status: "skipped", failure: { code: "too_short" }, score: null });
  }, 60_000);

  it("validates input with typed errors", async () => {
    const a = await submit({ categoryId: "early-bucket" });
    expect(a.status).toBe(400);
    expect(a.body.error).toMatchObject({ type: "invalid_request", code: "invalid_parameter" });
    expect(a.body.error.requestId).toMatch(/^req_/);
    const b = await submit(sample({ categoryId: "nope" }));
    expect(b.body.error).toMatchObject({ type: "not_found", code: "category_not_found", param: "categoryId" });
    const c = await submit({ categoryId: "early-bucket", person: { externalId: `AGT-${uniq()}` }, sampleId: "eb-hi-good" });
    expect(c.body.error.code).toBe("person_name_required");
  });
});

describe("list and sync", () => {
  it("paginates with stable cursors and filters", async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const page: { body: { data: Conversation[]; nextCursor: string | null } } = await json(await listConversations(req(`${C}?limit=25&categoryId=early-bucket${cursor ? `&cursor=${cursor}` : ""}`), none));
      for (const c of page.body.data) {
        expect(seen.has(c.id)).toBe(false);
        expect(c.categoryId).toBe("early-bucket");
        expect(c.transcript).toBeUndefined();
        seen.add(c.id);
      }
      cursor = page.body.nextCursor;
    }
    expect(seen.size).toBe(75);
    const low = await json(await listConversations(req(`${C}?sort=score&limit=5&status=completed&includeTotal=true&scoreMax=40`), none));
    expect(low.body.total).toBeGreaterThan(0);
    const scores = low.body.data.map((c: Conversation) => c.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(scores.every((s: number) => s <= 40)).toBe(true);
    const tagged = await json(await listConversations(req(`${C}?tag=objection&limit=10`), none));
    expect(tagged.body.data.every((c: Conversation) => c.tags.some((t) => t.slug.startsWith("objection")))).toBe(true);
  });

  it("updatedSince returns changes oldest-first, including deletion tombstones", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const r = await submit(sample());
    await waitFor(() => get(r.body.id), settled);
    const del = await deleteConversation(req(`${C}/${r.body.id}`, { method: "DELETE" }), params({ id: r.body.id }));
    expect(del.status).toBe(204);
    expect((await getConversation(req(`${C}/${r.body.id}`), params({ id: r.body.id }))).status).toBe(404);
    const sync = await json(await listConversations(req(`${C}?updatedSince=${encodeURIComponent(since)}`), none));
    const tomb = sync.body.data.find((c: Conversation) => c.id === r.body.id);
    expect(tomb).toMatchObject({ deleted: true, summary: null, scorecard: null, score: null });
    expect(tomb.audio.playbackUrl).toBeNull();
    const times = sync.body.data.map((c: Conversation) => c.updatedAt);
    expect([...times].sort()).toEqual(times);
  }, 60_000);
});

describe("people, cohorts, tags, categories", () => {
  it("upserts people on externalId and addresses them as ext:", async () => {
    const ext = `AGT-${uniq()}`;
    const a = await json(await createPerson(req("/api/v1/people", { method: "POST", json: { externalId: ext, name: "Asha" } }), none));
    expect(a.status).toBe(201);
    const b = await json(await createPerson(req("/api/v1/people", { method: "POST", json: { externalId: ext, name: "Asha K" } }), none));
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    const coh = await json(await createCohort(req("/api/v1/cohorts", { method: "POST", json: { name: "Pune Floor", language: "hi-en" } }), none));
    const p = await json(await patchPerson(req(`/api/v1/people/ext:${ext}`, { method: "PATCH", json: { cohortId: coh.body.id, active: false } }), params({ id: `ext:${ext}` })));
    expect(p.body).toMatchObject({ cohortId: coh.body.id, active: false });
    expect((await json(await getPerson(req(`/api/v1/people/${a.body.id}`), params({ id: a.body.id })))).body.externalId).toBe(ext);
  });

  it("publishes immutable rubric versions; validates rules and tags", async () => {
    const cat = (await json(await getCategory(req("/api/v1/categories/settlement"), params({ id: "settlement" })))).body;
    const { object: _o, id: _i, version, versions: _vs, createdAt: _c, updatedAt: _u, ...doc } = cat;
    const bad = await json(await putCategory(req("/api/v1/categories/settlement", { method: "PUT", json: { ...doc, tagTargets: [...doc.tagTargets, "no/such-tag"] } }), params({ id: "settlement" })));
    expect(bad.body.error).toMatchObject({ code: "invalid_rubric", param: "tagTargets" });
    await putTag(req("/api/v1/tags/no/such-tag", { method: "PUT", json: { displayName: "Such tag" } }), params({ slug: ["no", "such-tag"] }));
    const ok = await json(await putCategory(req("/api/v1/categories/settlement", { method: "PUT", json: { ...doc, tagTargets: [...doc.tagTargets, "no/such-tag"], description: "v2" } }), params({ id: "settlement" })));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ version: version + 1, description: "v2" });
    const old = await json(await getCategory(req(`/api/v1/categories/settlement?version=${version}`), params({ id: "settlement" })));
    expect(old.body).toMatchObject({ version, description: doc.description });
    const same = await json(await putCategory(req("/api/v1/categories/settlement", { method: "PUT", json: { ...doc, tagTargets: [...doc.tagTargets, "no/such-tag"], description: "v2" } }), params({ id: "settlement" })));
    expect(same.body.version).toBe(version + 1); // unchanged document: no new version
    expect((await json(await listCategories(req("/api/v1/categories"), none))).body.data.length).toBe(3);
  });
});

describe("analytics", () => {
  it("groups metrics by person, criterion and week", async () => {
    const byPerson = await json(await getAnalytics(req("/api/v1/analytics?metrics=volume,qualityScore,successRate,minutes&groupBy=person&from=2020-01-01"), none));
    expect(byPerson.body.rows.length).toBeGreaterThan(10);
    expect(byPerson.body.rows[0]).toMatchObject({ key: expect.any(String), label: expect.any(String), volume: expect.any(Number), qualityScore: expect.any(Number) });
    const byCrit = await json(await getAnalytics(req("/api/v1/analytics?metrics=passRate,agreement&groupBy=criterion&from=2020-01-01"), none));
    expect(byCrit.body.rows.some((r: { agreement: number | null }) => r.agreement != null)).toBe(true);
    const weeks = await json(await getAnalytics(req("/api/v1/analytics?groupBy=week&from=2020-01-01"), none));
    const keys = weeks.body.rows.map((r: { key: string }) => r.key);
    expect([...keys].sort()).toEqual(keys);
  });
});

describe("auth and isolation", () => {
  it("read-only keys can't write; other orgs see nothing", async () => {
    const ro = await newKey("read");
    expect((await listConversations(req(`${C}?limit=1`, { key: ro }), none)).status).toBe(200);
    const w = await json(await createConversation(req(C, { method: "POST", key: ro, json: sample() }), none));
    expect(w.body.error).toMatchObject({ type: "permission", code: "insufficient_scope" });

    await db.insert(schema.organizations).values({ id: "org_other", name: "Other" }).onConflictDoNothing();
    await db.insert(schema.users).values({ id: "u_other_admin", orgId: "org_other", name: "Other Admin", email: "admin@other.test", role: "admin" }).onConflictDoNothing();
    const other = await newKey("write", "org_other");
    const [any] = (await json(await listConversations(req(`${C}?limit=1`), none))).body.data;
    expect((await json(await getConversation(req(`${C}/${any.id}`, { key: other }), params({ id: any.id })))).status).toBe(404);
    expect((await json(await listConversations(req(C, { key: other }), none))).body.data).toEqual([]);
    expect((await json(await getCategory(req("/api/v1/categories/early-bucket", { key: other }), params({ id: "early-bucket" })))).status).toBe(404);
  });

  it("rate-limits per key with standard headers", async () => {
    const auth = await newKey();
    process.env.RATE_LIMIT_PER_MIN = "3";
    try {
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await listCategories(req("/api/v1/categories", { key: auth }), none)).status);
      expect(codes).toEqual([200, 200, 200, 429]);
    } finally {
      delete process.env.RATE_LIMIT_PER_MIN;
    }
  });
});

describe("OpenAPI", () => {
  it("documents every operation from the zod contract", async () => {
    const doc = await (await openapi(new Request("http://test/api/v1/openapi.json"))).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/conversations", "/conversations/{id}", "/conversations/{id}/scorecard", "/uploads", "/analytics", "/webhooks"]));
    expect(doc.paths["/conversations"].post.requestBody.content["application/json"].schema.properties.externalId).toBeDefined();
  });
});
