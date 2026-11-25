import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import type { Actor } from "@/server/auth";
import { content } from "@/server/pipeline/providers/mock";
import { providerStatus } from "@/server/pipeline/providers/registry";
import { storageDriver } from "@/server/storage";

/** UI bootstrap (/api/internal/workspace): who I am, and the org's configuration in one round trip. */
export async function getWorkspace(actor: Actor) {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, actor.orgId));
  const [cats, cohorts, users, tags] = await Promise.all([
    db.select().from(schema.categories).where(eq(schema.categories.orgId, actor.orgId)),
    db.select().from(schema.cohorts).where(eq(schema.cohorts.orgId, actor.orgId)),
    db.select().from(schema.users).where(eq(schema.users.orgId, actor.orgId)),
    db.select().from(schema.tags).where(eq(schema.tags.orgId, actor.orgId)),
  ]);
  const { templates, timings } = content();
  const providers = providerStatus();
  return {
    org,
    me: users.find((u) => u.id === actor.userId)!,
    categories: cats.map((c) => ({ id: c.id, name: c.name, description: c.description, icon: c.icon, rubricVersion: c.rubricVersion, rubric: c.rubric })),
    cohorts,
    people: users.filter((u) => u.role === "member" && !u.deactivatedAt),
    staff: users.filter((u) => u.role !== "member"),
    tags,
    /** bundled demo recordings that can be submitted for a fully consistent analysis */
    samples: [...templates.values()]
      .filter((t) => timings[t.id])
      .map((t) => ({ id: t.id, categoryId: t.categoryId, language: t.language, customerName: t.customerName, durationSec: Math.round(timings[t.id].duration) })),
    system: { llm: providers.llm, asr: providers.asr, llmFallback: providers.llmFallback, asrFallback: providers.asrFallback, mock: providers.mock, keys: actor.role === "admin" ? providers.keys : {}, error: providers.error, storage: storageDriver() },
  };
}
export type Workspace = Awaited<ReturnType<typeof getWorkspace>>;
