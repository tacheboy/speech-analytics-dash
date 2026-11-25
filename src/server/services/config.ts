import { and, asc, count, eq, inArray, like, or } from "drizzle-orm";
import { categoryBody, cohortBody, tagBody, type Category, type Cohort, type Tag } from "@/lib/contract";
import type { Rubric } from "@/lib/domain";
import { ApiError, notFound, requireAdmin, requireStaff, type Actor } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { newId } from "@/server/ids";
import { rubricAt } from "@/server/rubrics";

/** Categories (versioned rubrics), cohorts and the tag taxonomy: the configuration side of the API. */
const { categories, rubricVersions, cohorts, users, tags } = schema;

/* ---------------- categories ---------------- */

type CategoryRow = typeof categories.$inferSelect;

async function presentCategory(c: CategoryRow, rubric: Rubric, version: number): Promise<Category> {
  const versions = await db.select({ v: rubricVersions.version }).from(rubricVersions).where(eq(rubricVersions.categoryId, c.id)).orderBy(asc(rubricVersions.version));
  const { id: _id, ...doc } = rubric;
  return { object: "category", id: c.id, ...doc, version, versions: versions.map((v) => v.v), createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

export async function listCategories(actor: Actor) {
  const rows = await db.select().from(categories).where(eq(categories.orgId, actor.orgId)).orderBy(asc(categories.name));
  return { object: "list" as const, data: await Promise.all(rows.map((c) => presentCategory(c, c.rubric, c.rubricVersion))), nextCursor: null };
}

export async function getCategory(actor: Actor, id: string, version?: number) {
  const [c] = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.orgId, actor.orgId)));
  if (!c) throw notFound("Category");
  if (version && version !== c.rubricVersion) {
    const r = await rubricAt(c.id, version);
    if (!r) throw new ApiError(404, "rubric_version_not_found", `Version ${version} not found`, "version");
    return presentCategory(c, r, version);
  }
  return presentCategory(c, c.rubric, c.rubricVersion);
}

/** Semantic checks zod can't express: unique ids, rules that point at real targets, known tags. */
async function validateRubric(orgId: string, r: Rubric) {
  const fail = (msg: string, param?: string) => { throw new ApiError(400, "invalid_rubric", msg, param); };
  const sectionIds = new Set<string>(), criterionIds = new Set<string>();
  for (const s of r.sections) {
    if (sectionIds.has(s.id)) fail(`Duplicate section id ${s.id}`, "sections");
    sectionIds.add(s.id);
    for (const c of s.criteria) {
      if (criterionIds.has(c.id)) fail(`Duplicate criterion id ${c.id}`, "sections");
      criterionIds.add(c.id);
    }
  }
  if (!r.outcomes.length) fail("At least one outcome is required", "outcomes");
  if (new Set(r.outcomes.map((o) => o.id)).size !== r.outcomes.length) fail("Duplicate outcome id", "outcomes");
  if (new Set(r.extractionFields.map((f) => f.fieldName)).size !== r.extractionFields.length) fail("Duplicate extraction fieldName", "extractionFields");
  for (const f of r.extractionFields) if (f.fieldType === "enum" && !f.enumOptions?.length) fail(`Enum field ${f.fieldName} needs enumOptions`, "extractionFields");
  const known = new Set((await db.select({ slug: tags.slug }).from(tags).where(eq(tags.orgId, orgId))).map((t) => t.slug));
  for (const slug of r.tagTargets) if (!known.has(slug)) fail(`Unknown tag ${slug} in tagTargets (create it with PUT /tags/${slug})`, "tagTargets");
  for (const t of r.targetingRules) {
    const ok = t.targetType === "section" ? sectionIds.has(t.targetId) : t.targetType === "criterion" ? criterionIds.has(t.targetId) : known.has(t.targetId);
    if (!ok) fail(`Targeting rule points at unknown ${t.targetType} ${t.targetId}`, "targetingRules");
    try {
      const jsonLogic = (await import("json-logic-js")).default;
      jsonLogic.apply(t.expression as never, { outcome: {}, extractions: {}, criteria: {} } as never);
    } catch (e) {
      fail(`Targeting rule for ${t.targetId} doesn't evaluate: ${(e as Error).message}`, "targetingRules");
    }
  }
}

/** JSON with sorted keys: jsonb doesn't keep key order, so plain stringify can't tell "unchanged". */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v);

/** PUT /categories/{id}: creates the category, or publishes a new immutable rubric version. Unchanged documents are a no-op. */
export async function putCategory(actor: Actor, id: string, raw: unknown) {
  requireAdmin(actor, "publish rubrics");
  if (!/^[a-z0-9][a-z0-9-_]{1,62}$/.test(id)) throw new ApiError(400, "invalid_category_id", "Category ids are 2–63 lowercase letters, digits, - or _", "id");
  const doc = categoryBody.parse(raw);
  const rubric: Rubric = { id, ...doc };
  await validateRubric(actor.orgId, rubric);
  const [existing] = await db.select().from(categories).where(eq(categories.id, id));
  if (existing && existing.orgId !== actor.orgId) throw new ApiError(409, "category_id_taken", "That category id is taken", "id");
  if (existing && canonical(existing.rubric) === canonical(rubric)) return { category: await presentCategory(existing, existing.rubric, existing.rubricVersion), created: false };
  const version = existing ? existing.rubricVersion + 1 : 1;
  await db.transaction(async (tx) => {
    const fields = { name: doc.name, description: doc.description, icon: doc.icon, rubric, rubricVersion: version, updatedAt: new Date() };
    if (existing) await tx.update(categories).set(fields).where(eq(categories.id, id));
    else await tx.insert(categories).values({ id, orgId: actor.orgId, ...fields });
    await tx.insert(rubricVersions).values({ categoryId: id, version, rubric, createdBy: actor.userId });
  });
  return { category: await getCategory(actor, id), created: !existing };
}

/* ---------------- cohorts ---------------- */

async function presentCohorts(orgId: string, ids?: string[]): Promise<Cohort[]> {
  const rows = await db.select().from(cohorts).where(and(eq(cohorts.orgId, orgId), ids ? inArray(cohorts.id, ids) : undefined)).orderBy(asc(cohorts.name));
  const counts = await db.select({ cohortId: users.cohortId, n: count() }).from(users).where(and(eq(users.orgId, orgId), eq(users.role, "member"))).groupBy(users.cohortId);
  return rows.map((c) => ({ object: "cohort", id: c.id, name: c.name, language: c.language, people: counts.find((x) => x.cohortId === c.id)?.n ?? 0, createdAt: c.createdAt.toISOString() }));
}

export async function listCohorts(actor: Actor) {
  return { object: "list" as const, data: await presentCohorts(actor.orgId), nextCursor: null };
}

export async function createCohort(actor: Actor, raw: unknown) {
  requireStaff(actor, "manage cohorts");
  const body = cohortBody.parse(raw);
  const id = newId("coh");
  await db.insert(cohorts).values({ id, orgId: actor.orgId, name: body.name, language: body.language ?? null });
  return (await presentCohorts(actor.orgId, [id]))[0];
}

export async function updateCohort(actor: Actor, id: string, raw: unknown) {
  requireStaff(actor, "manage cohorts");
  const body = cohortBody.partial().parse(raw);
  const res = await db.update(cohorts).set(body).where(and(eq(cohorts.id, id), eq(cohorts.orgId, actor.orgId))).returning({ id: cohorts.id });
  if (!res.length) throw notFound("Cohort");
  return (await presentCohorts(actor.orgId, [id]))[0];
}

/* ---------------- tags ---------------- */

const parentOf = (slug: string) => (slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/")) : null);
const presentTag = (t: typeof tags.$inferSelect): Tag => ({ object: "tag", slug: t.slug, displayName: t.displayName, description: t.description, assignable: t.assignable, parent: parentOf(t.slug) });

export async function listTags(actor: Actor, prefix?: string) {
  const rows = await db.select().from(tags).where(and(eq(tags.orgId, actor.orgId), prefix ? or(eq(tags.slug, prefix), like(tags.slug, `${prefix}/%`)) : undefined)).orderBy(asc(tags.slug));
  return { object: "list" as const, data: rows.map(presentTag), nextCursor: null };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,4}$/;

/** PUT /tags/{slug}: upsert by slug path; missing parents are created (named after their slug segment). */
export async function putTag(actor: Actor, slug: string, raw: unknown) {
  requireStaff(actor, "manage tags");
  if (!SLUG.test(slug)) throw new ApiError(400, "invalid_tag_slug", "Tag slugs are lowercase words joined by -, nested with / (up to 5 levels)", "slug");
  const body = tagBody.parse(raw);
  const parts = slug.split("/");
  await db.transaction(async (tx) => {
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join("/");
      const name = parts[i - 1].replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
      await tx.insert(tags).values({ id: newId("tag"), orgId: actor.orgId, slug: p, displayName: name }).onConflictDoNothing();
    }
    await tx.insert(tags).values({ id: newId("tag"), orgId: actor.orgId, slug, displayName: body.displayName, description: body.description ?? null, assignable: body.assignable ?? false })
      .onConflictDoUpdate({ target: [tags.orgId, tags.slug], set: { displayName: body.displayName, ...(body.description !== undefined ? { description: body.description } : {}), ...(body.assignable !== undefined ? { assignable: body.assignable } : {}) } });
  });
  const [t] = await db.select().from(tags).where(and(eq(tags.orgId, actor.orgId), eq(tags.slug, slug)));
  return presentTag(t);
}
