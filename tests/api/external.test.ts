import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { GET as listAgents, POST as createAgent } from "@/app/api/external/v1/agents/route";
import { DELETE as deleteAgent, PATCH as patchAgent } from "@/app/api/external/v1/agents/[id]/route";
import { POST as createCall } from "@/app/api/external/v1/calls/route";
import { POST as presign } from "@/app/api/external/v1/calls/presigned-url/route";
import { GET as getAnalysis } from "@/app/api/external/v1/calls/[callId]/analysis/route";
import { GET as listCategories } from "@/app/api/external/v1/categories/route";
import { GET as getCategory } from "@/app/api/external/v1/categories/[categoryId]/route";
import { PUT as putUpload } from "@/app/api/external/v1/uploads/[key]/route";
import { GET as listKeys, POST as createKey } from "@/app/api/v1/integrations/keys/route";
import { DELETE as revokeKey } from "@/app/api/v1/integrations/keys/[id]/route";
import { GET as listHooks, POST as createHook } from "@/app/api/v1/integrations/webhooks/route";
import { db, schema } from "@/server/db/client";
import { parseCallDate } from "@/server/external/dates";
import { UPLOAD_DIR } from "@/server/services/ingest";

const BASE = "http://test/api/external/v1";
const AUTH = { authorization: "Bearer test_key" };
const req = (p: string, init: RequestInit & { json?: unknown; key?: Record<string, string> } = {}) =>
  new Request(p.startsWith("http") ? p : `${BASE}${p}`, {
    ...init,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    headers: { ...(init.key ?? AUTH), ...(init.json !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
const none = undefined as never;
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const uniq = () => Math.random().toString(36).slice(2, 8);
const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((f) => fs.rm(path.join(UPLOAD_DIR, f), { force: true })));
});

/** presigned URL + PUT, as in the quickstart; returns the publicUrl */
async function upload(filename = "demo-call.mp3") {
  const { key, presignedUrl, publicUrl } = (await json(await presign(req("/calls/presigned-url", { method: "POST", json: { filename, contentType: "audio/mpeg" } }), none))).body.data;
  created.push(key);
  await putUpload(new Request(presignedUrl, { method: "PUT", body: new Uint8Array(512).fill(1) }), { params: Promise.resolve({ key }) });
  return publicUrl as string;
}

async function finish(callId: string) {
  await db.update(schema.calls).set({ readyAt: new Date(Date.now() - 1000) }).where(eq(schema.calls.id, callId));
  return json(await getAnalysis(req(`/calls/${callId}/analysis`), { params: Promise.resolve({ callId }) }));
}

describe("auth", () => {
  it("returns the documented 401 messages", async () => {
    expect(await json(await listAgents(req("/agents", { key: {} }), none))).toEqual({ status: 401, body: { error: "Missing API key" } });
    expect(await json(await listAgents(req("/agents", { key: { authorization: "Bearer nope" } }), none))).toEqual({ status: 401, body: { error: "Invalid API key" } });
    expect((await listAgents(req("/agents", { key: { "x-api-key": "test_key" } }), none)).status).toBe(200);
  });

  it("accepts keys created in Integrations until they are revoked", async () => {
    const k = await json(await createKey(new Request("http://test/api/v1/integrations/keys", { method: "POST", headers: { "x-api-key": "test_key" }, body: JSON.stringify({ name: "CRM" }) }), none));
    expect(k.status).toBe(201);
    expect(k.body.data.key).toMatch(/^vb_live_/);
    expect(k.body.data.prefix).toBe(k.body.data.key.slice(0, 12));
    const key = k.body.data.key as string;
    expect((await listCategories(req("/categories", { key: { "x-api-key": key } }), none)).status).toBe(200);
    const keys = (await json(await listKeys(new Request("http://test/api/v1/integrations/keys", { headers: { authorization: `Bearer ${key}` } }), none))).body.data;
    const row = keys.find((x: { id: string }) => x.id === k.body.data.id);
    expect(row.lastUsedAt).not.toBeNull();
    expect(row).not.toHaveProperty("hash");
    await revokeKey(new Request("http://test", { method: "DELETE", headers: { "x-api-key": "test_key" } }), { params: Promise.resolve({ id: k.body.data.id }) });
    expect((await json(await listCategories(req("/categories", { key: { "x-api-key": key } }), none))).body).toEqual({ error: "Invalid API key" });
  });
});

describe("quickstart", () => {
  it("create agent → presigned URL → PUT → create call → poll completed", async () => {
    const email = `jane.${uniq()}@example.com`;
    const agent = await json(await createAgent(req("/agents", { method: "POST", json: { name: "Jane Agent", email } }), none));
    expect(agent.status).toBe(201);
    expect(agent.body.data).toMatchObject({ name: "Jane Agent", email });
    const MEMBER_ID = agent.body.data.id;
    expect(agent.body.data.userId).toBe(MEMBER_ID);

    const pre = await json(await presign(req("/calls/presigned-url", { method: "POST", json: { filename: "demo-call.mp3", contentType: "audio/mpeg" } }), none));
    expect(pre.status).toBe(200);
    const { key, presignedUrl, publicUrl } = pre.body.data;
    created.push(key);
    expect(publicUrl).toBe(`http://test/uploads/${key}`);

    const bytes = new Uint8Array(2048).fill(7);
    const bad = await putUpload(new Request(presignedUrl.replace(/sig=\w+/, "sig=" + "0".repeat(64)), { method: "PUT", body: bytes }), { params: Promise.resolve({ key }) });
    expect(bad.status).toBe(403);
    const put = await putUpload(new Request(presignedUrl, { method: "PUT", headers: { "content-type": "audio/mpeg" }, body: bytes }), { params: Promise.resolve({ key }) });
    expect(put.status).toBe(200);
    expect((await fs.stat(path.join(UPLOAD_DIR, key))).size).toBe(2048);

    const call = await json(await createCall(req("/calls", { method: "POST", json: { memberId: MEMBER_ID, categoryId: "early-bucket", audio_url: publicUrl, udfs: { leadId: "lead_123" } } }), none));
    expect(call.status).toBe(202);
    expect(call.body.data.status).toBe("processing");
    const CALL_ID = call.body.data.callId;

    const pending = await json(await getAnalysis(req(`/calls/${CALL_ID}/analysis`), { params: Promise.resolve({ callId: CALL_ID }) }));
    expect(pending.body.data).toMatchObject({ callId: CALL_ID, status: "processing", analysis: null });

    const done = (await finish(CALL_ID)).body.data;
    expect(done.status).toBe("completed");
    expect(done.metadata).toMatchObject({ audioUrl: publicUrl, udfs: { leadId: "lead_123" } });
    expect(done.metadata.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const a = done.analysis;
    expect(typeof a.score).toBe("number");
    expect(a.outcomeLabel).toBeTruthy();
    expect(a.sections.length).toBeGreaterThan(0);
    expect(a.sections.map((s: { sectionId: string }) => s.sectionId)[0]).toBe("opening"); // rubric order
    for (const s of a.sections) {
      expect(s.totalScore).toBe(s.criterias.filter((c: { result: string }) => c.result !== "na").length);
      expect(s.score).toBe(s.criterias.filter((c: { result: string }) => c.result === "yes").length);
      for (const c of s.criterias) {
        expect(Object.keys(c).sort()).toEqual(["criteriaId", "question", "rationale", "result"]);
        expect(["yes", "no", "na"]).toContain(c.result);
      }
    }
    expect(Array.isArray(a.extractions)).toBe(true);
    expect(Object.keys(a.extractions[0]).sort()).toEqual(["description", "displayName", "enumValues", "fieldName", "fieldType", "id", "required", "value"]);
  });

  it("validates POST /calls", async () => {
    const r = (body: unknown) => createCall(req("/calls", { method: "POST", json: body }), none).then(json);
    expect((await r({ categoryId: "early-bucket", audio_url: "https://x.test/a.mp3" })).status).toBe(400);
    expect(await r({ memberId: "rahul.sharma@kaverifinance.in", categoryId: "nope", audio_url: "https://x.test/a.mp3" })).toEqual({ status: 404, body: { error: "Category not found" } });
    expect((await r({ memberId: "ghost@example.com", categoryId: "early-bucket", audio_url: "https://x.test/a.mp3" })).status).toBe(404);
    expect((await r({ memberId: "rahul.sharma@kaverifinance.in", categoryId: "early-bucket", audio_url: "https://x.test/a.mp3", date: "31-02-2026" })).status).toBe(400);
  });

  it("stores the call date, accepts an agent email, and fails remote recordings that can't be ingested", async () => {
    const r = await json(await createCall(req("/calls", { method: "POST", json: { memberId: "rahul.sharma@kaverifinance.in", categoryId: "early-bucket", audio_url: "http://127.0.0.1:1/missing.mp3", date: "2026-04-09" } }), none));
    expect(r.status).toBe(202);
    const id = r.body.data.callId;
    const [row] = await db.select().from(schema.calls).where(eq(schema.calls.id, id));
    expect(row.callAt.toISOString()).toBe("2026-04-09T03:30:00.000Z");
    // remote ingestion runs fire-and-forget outside a request; wait for it to record the failure
    for (let i = 0; i < 50; i++) {
      const [c] = await db.select({ f: schema.calls.failureReason }).from(schema.calls).where(eq(schema.calls.id, id));
      if (c.f) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    const done = (await finish(id)).body.data;
    expect(done.status).toBe("failed");
    expect(done.analysis).toBeNull();
    const [failed] = await db.select().from(schema.calls).where(eq(schema.calls.id, id));
    expect(failed.failureReason).toMatch(/^Unable to ingest recording: /);
  });
});

describe("date parsing", () => {
  it.each([
    ["2026-04-09", "2026-04-09T03:30:00.000Z"],
    ["2026-04-09T10:15:00Z", "2026-04-09T10:15:00.000Z"],
    ["2026-04-09T10:15:00+05:30", "2026-04-09T04:45:00.000Z"],
    ["2026/04/09", "2026-04-09T03:30:00.000Z"],
    ["2026/04/09 14:30", "2026-04-09T09:00:00.000Z"],
    ["09-04-2026", "2026-04-09T03:30:00.000Z"],
    ["09/04/2026 18:05", "2026-04-09T12:35:00.000Z"],
  ])("%s → %s", (input, iso) => expect(parseCallDate(input)?.toISOString()).toBe(iso));
  it("rejects nonsense", () => {
    for (const s of ["", "yesterday", "2026-13-01", "31/02/2026", "2026-04-09 25:00"]) expect(parseCallDate(s)).toBeNull();
  });
});

describe("agents", () => {
  it("409s on duplicate email, updates, soft-deletes", async () => {
    const email = `dup.${uniq()}@example.com`;
    const a = await json(await createAgent(req("/agents", { method: "POST", json: { name: "Dup", email } }), none));
    expect(a.status).toBe(201);
    expect(await json(await createAgent(req("/agents", { method: "POST", json: { name: "Dup 2", email: email.toUpperCase() } }), none))).toEqual({ status: 409, body: { error: "Email already in use" } });
    expect((await json(await createAgent(req("/agents", { method: "POST", json: { name: "Rahul", email: "rahul.sharma@kaverifinance.in" } }), none))).status).toBe(409);
    expect((await json(await createAgent(req("/agents", { method: "POST", json: { name: "x" } }), none))).status).toBe(400);

    const ctx = { params: Promise.resolve({ id: a.body.data.id }) };
    expect((await json(await patchAgent(req(`/agents/${a.body.data.id}`, { method: "PATCH", json: { email: "rahul.sharma@kaverifinance.in" } }), ctx))).status).toBe(409);
    const p = await json(await patchAgent(req(`/agents/${a.body.data.id}`, { method: "PATCH", json: { name: "Renamed" } }), ctx));
    expect(p.body).toEqual({ data: { memberId: a.body.data.id, userId: a.body.data.id, name: "Renamed", email, image: null } });

    const list = (await json(await listAgents(req("/agents"), none))).body.data;
    expect(list.find((x: { id: string }) => x.id === a.body.data.id)).toMatchObject({ name: "Renamed", image: null });
    expect(await json(await deleteAgent(req(`/agents/${a.body.data.id}`, { method: "DELETE" }), ctx))).toEqual({ status: 200, body: { success: true } });
    const after = (await json(await listAgents(req("/agents"), none))).body.data;
    expect(after.some((x: { id: string }) => x.id === a.body.data.id)).toBe(false);
    expect((await deleteAgent(req(`/agents/${a.body.data.id}`, { method: "DELETE" }), ctx)).status).toBe(404);
  });
});

describe("categories", () => {
  it("lists and returns the docs detail shape", async () => {
    const list = (await json(await listCategories(req("/categories"), none))).body.data;
    expect(list).toHaveLength(3);
    expect(Object.keys(list[0]).sort()).toEqual(["createdAt", "description", "icon", "id", "name", "updatedAt"]);

    const { status, body } = await json(await getCategory(req("/categories/settlement"), { params: Promise.resolve({ categoryId: "settlement" }) }));
    expect(status).toBe(200);
    const d = body.data;
    expect(typeof d.intendedPurpose).toBe("string");
    expect(typeof d.additionalLLMContext).toBe("string");
    expect(d.possibleOutcomes[0]).toEqual(expect.objectContaining({ id: expect.any(String), label: expect.any(String), isSuccess: expect.any(Boolean), isNotApplicable: expect.any(Boolean) }));
    expect(d.analysisPointers[0]).toMatchObject({ id: expect.any(String), sectionId: expect.any(String), sectionName: expect.any(String) });
    expect(Object.keys(d.analysisPointers[0].criterias[0]).sort()).toEqual(["criteriaId", "id", "question"]);
    const en = d.extractionFields.find((f: { enumOptions: unknown[] }) => f.enumOptions.length);
    expect(en.enumValues).toEqual(en.enumOptions.map((o: { value: string }) => o.value));
    expect(d.targetingRules[0]).toEqual({ targetType: expect.any(String), targetId: expect.any(String), expression: expect.any(Object) });
    expect(d.tagTargets.length).toBeGreaterThan(0);
    expect(Object.keys(d.tagTargets[0]).sort()).toEqual(["displayName", "id", "slug"]);

    expect(await json(await getCategory(req("/categories/nope"), { params: Promise.resolve({ categoryId: "nope" }) }))).toEqual({ status: 404, body: { error: "Category not found" } });
  });
});

describe("webhooks", () => {
  it("delivers a signed call.analysis_complete to a local endpoint and logs it", async () => {
    const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((rq, rs) => {
      let body = "";
      rq.on("data", (c) => (body += c));
      rq.on("end", () => {
        received.push({ headers: rq.headers, body });
        rs.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      });
    });
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as AddressInfo).port;
    try {
      const hook = await json(await createHook(new Request("http://test/api/v1/integrations/webhooks", { method: "POST", headers: { "x-api-key": "test_key" }, body: JSON.stringify({ url: `http://127.0.0.1:${port}/hook`, events: ["call.analysis_complete"] }) }), none));
      expect(hook.status).toBe(201);
      const secret = hook.body.data.secret as string;

      const call = await json(await createCall(req("/calls", { method: "POST", json: { memberId: "rahul.sharma@kaverifinance.in", categoryId: "early-bucket", audio_url: await upload(), udfs: { source: "test" } } }), none));
      const callId = call.body.data.callId;
      expect((await finish(callId)).body.data.status).toBe("completed");

      expect(received).toHaveLength(1);
      const { headers, body } = received[0];
      expect(headers["x-insights-event"]).toBe("call.analysis_complete");
      const expected = createHmac("sha256", secret).update(`${headers["x-insights-timestamp"]}.${body}`).digest("hex");
      const provided = String(headers["x-insights-signature"]).replace(/^v1=/, "");
      expect(timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))).toBe(true);

      const payload = JSON.parse(body);
      expect(payload.id).toBe(headers["x-insights-delivery-id"]);
      expect(payload.type).toBe("call.analysis_complete");
      expect(payload.data).toMatchObject({ callId, organizationId: "org_kaveri", memberId: "u_rahul_sharma", categoryId: "early-bucket", udfs: { source: "test" }, uploadedBy: "u_admin" });
      expect(payload.data.audioUrl).toMatch(/^https?:\/\/.+\/uploads\/.+\.mp3$/);
      expect(payload.data.transcript[0]).toEqual({ start: expect.any(Number), end: expect.any(Number), speaker: expect.any(String), content: expect.any(String) });
      expect(payload.data.analytics[0].criterias[0]).toEqual({ criteriaId: expect.any(String), question: expect.any(String), result: expect.anything(), rationale: expect.any(String) });
      expect(Array.isArray(payload.data.tags)).toBe(true);

      const hooks = (await json(await listHooks(new Request("http://test/api/v1/integrations/webhooks", { headers: { "x-api-key": "test_key" } }), none))).body.data;
      const h = hooks.find((x: { id: string }) => x.id === hook.body.data.id);
      expect(h).not.toHaveProperty("secret");
      expect(h.deliveries[0]).toMatchObject({ event: "call.analysis_complete", statusCode: 200, responseBody: '{"ok":true}', error: null });
    } finally {
      server.close();
      await db.delete(schema.webhooks);
    }
  });
});
