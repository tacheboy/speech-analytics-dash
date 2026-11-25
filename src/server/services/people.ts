import { and, asc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { listPeopleQuery, personBody, personPatchBody, type CreateConversationBody, type List, type Person } from "@/lib/contract";
import { ApiError, notFound, requireStaff, type Actor } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { decodeCursor, encodeCursor } from "@/server/http";
import { newId, parseRef } from "@/server/ids";

const { users, cohorts } = schema;
type User = typeof users.$inferSelect;

export const presentPerson = (u: User): Person => ({
  object: "person", id: u.id, externalId: u.externalId, name: u.name, email: u.email, cohortId: u.cohortId,
  active: !u.deactivatedAt, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString(),
});

const isMember = (orgId: string) => and(eq(users.orgId, orgId), eq(users.role, "member"));

async function findPerson(actor: Actor, ref: string) {
  const r = parseRef(ref);
  const [u] = await db.select().from(users).where(and(isMember(actor.orgId), "id" in r ? eq(users.id, r.id!) : eq(users.externalId, r.externalId)));
  if (!u || (actor.role === "member" && u.id !== actor.userId)) throw notFound("Person");
  return u;
}

export async function listPeople(actor: Actor, raw: unknown): Promise<List<Person>> {
  const q = listPeopleQuery.parse(raw);
  const where: (SQL | undefined)[] = [isMember(actor.orgId)];
  if (actor.role === "member") where.push(eq(users.id, actor.userId));
  if (q.cohortId) where.push(eq(users.cohortId, q.cohortId));
  if (q.active !== undefined) where.push(q.active ? isNull(users.deactivatedAt) : isNotNull(users.deactivatedAt));
  if (q.q) where.push(or(ilike(users.name, `%${q.q}%`), ilike(users.email, `%${q.q}%`), ilike(users.externalId, `%${q.q}%`)));
  const cursor = decodeCursor(q.cursor);
  if (cursor) where.push(sql`(${users.name}, ${users.id}) > (${String(cursor[0])}, ${String(cursor[1])})`);
  const rows = await db.select().from(users).where(and(...where)).orderBy(asc(users.name), asc(users.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return { object: "list", data: page.map(presentPerson), nextCursor: rows.length > q.limit && last ? encodeCursor([last.name, last.id]) : null };
}

export async function getPerson(actor: Actor, ref: string) {
  return presentPerson(await findPerson(actor, ref));
}

async function checkCohort(orgId: string, cohortId: string | null | undefined) {
  if (!cohortId) return;
  const [c] = await db.select({ id: cohorts.id }).from(cohorts).where(and(eq(cohorts.id, cohortId), eq(cohorts.orgId, orgId)));
  if (!c) throw new ApiError(404, "cohort_not_found", `Cohort ${cohortId} not found`, "cohortId");
}

async function emailOwner(email: string) {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  return u ?? null;
}

/** POST /people: upsert. A match on externalId (then email) returns the existing person (200), else creates one (201). */
export async function createPerson(actor: Actor, raw: unknown): Promise<{ person: Person; created: boolean }> {
  requireStaff(actor, "manage people");
  const body = personBody.parse(raw);
  const existing = await matchPerson(actor.orgId, body.externalId ?? undefined, body.email ?? undefined);
  if (existing) return { person: presentPerson(existing), created: false };
  await checkCohort(actor.orgId, body.cohortId);
  if (body.email && (await emailOwner(body.email))) throw new ApiError(409, "email_in_use", "That email belongs to another user", "email");
  const [u] = await db.insert(users).values({
    id: newId("per"), orgId: actor.orgId, role: "member", name: body.name,
    email: body.email?.toLowerCase() ?? null, externalId: body.externalId ?? null, cohortId: body.cohortId ?? null,
  }).returning();
  return { person: presentPerson(u), created: true };
}

export async function updatePerson(actor: Actor, ref: string, raw: unknown) {
  requireStaff(actor, "manage people");
  const body = personPatchBody.parse(raw);
  const u = await findPerson(actor, ref);
  await checkCohort(actor.orgId, body.cohortId);
  if (body.email) {
    const owner = await emailOwner(body.email);
    if (owner && owner.id !== u.id) throw new ApiError(409, "email_in_use", "That email belongs to another user", "email");
  }
  if (body.externalId) {
    const [owner] = await db.select({ id: users.id }).from(users).where(and(eq(users.orgId, actor.orgId), eq(users.externalId, body.externalId)));
    if (owner && owner.id !== u.id) throw new ApiError(409, "external_id_in_use", "Another person has that externalId", "externalId");
  }
  const { active, ...rest } = body;
  const patch: Partial<typeof users.$inferInsert> = { ...rest, ...(rest.email ? { email: rest.email.toLowerCase() } : {}), updatedAt: new Date() };
  if (active !== undefined) patch.deactivatedAt = active ? null : u.deactivatedAt ?? new Date();
  const [row] = await db.update(users).set(patch).where(eq(users.id, u.id)).returning();
  return presentPerson(row);
}

async function matchPerson(orgId: string, externalId?: string, email?: string) {
  if (externalId) {
    const [u] = await db.select().from(users).where(and(isMember(orgId), eq(users.externalId, externalId)));
    if (u) return u;
  }
  if (email) {
    const [u] = await db.select().from(users).where(and(isMember(orgId), sql`lower(${users.email}) = ${email.toLowerCase()}`));
    if (u) return u;
  }
  return null;
}

/** The person a new conversation belongs to: by id, or matched/created inline from `person`. */
export async function resolvePersonForConversation(actor: Actor, body: Pick<CreateConversationBody, "personId" | "person">) {
  if (body.personId) {
    const r = parseRef(body.personId);
    const [u] = await db.select().from(users).where(and(isMember(actor.orgId), "id" in r ? eq(users.id, r.id!) : eq(users.externalId, r.externalId)));
    if (!u) throw new ApiError(404, "person_not_found", `Person ${body.personId} not found`, "personId");
    if (u.deactivatedAt) throw new ApiError(409, "person_inactive", "That person is deactivated", "personId");
    return u;
  }
  const p = body.person!;
  const found = await matchPerson(actor.orgId, p.externalId, p.email);
  if (found) {
    if (found.deactivatedAt) throw new ApiError(409, "person_inactive", "That person is deactivated", "person");
    // learn the dialer's agent id the first time we see it next to a known email
    if (p.externalId && !found.externalId) await db.update(users).set({ externalId: p.externalId, updatedAt: new Date() }).where(eq(users.id, found.id));
    return found;
  }
  if (!p.name) throw new ApiError(400, "person_name_required", "person.name is required to create a new person", "person.name");
  if (p.email && (await emailOwner(p.email))) throw new ApiError(409, "email_in_use", "That email belongs to another user", "person.email");
  const [u] = await db.insert(users).values({ id: newId("per"), orgId: actor.orgId, role: "member", name: p.name, email: p.email?.toLowerCase() ?? null, externalId: p.externalId ?? null }).returning();
  return u;
}
