import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import type { Actor } from "@/server/auth";
import { content } from "@/server/pipeline/mock-analyzer";

export async function getWorkspace(actor: Actor) {
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, actor.orgId));
  const [cats, teams, users, tags] = await Promise.all([
    db.select().from(schema.categories).where(eq(schema.categories.orgId, actor.orgId)),
    db.select().from(schema.teams).where(eq(schema.teams.orgId, actor.orgId)),
    db.select().from(schema.users).where(eq(schema.users.orgId, actor.orgId)),
    db.select().from(schema.tags).where(eq(schema.tags.orgId, actor.orgId)),
  ]);
  const { templates, timings } = content();
  return {
    org,
    me: users.find((u) => u.id === actor.userId)!,
    categories: cats.map((c) => ({ id: c.id, name: c.name, description: c.description, icon: c.icon, rubricVersion: c.rubricVersion, rubric: c.rubric })),
    teams,
    agents: users.filter((u) => u.role === "agent" && !u.deactivatedAt),
    staff: users.filter((u) => u.role !== "agent"),
    tags,
    /** bundled demo recordings that can be "uploaded" for a fully consistent analysis */
    samples: [...templates.values()]
      .filter((t) => timings[t.id])
      .map((t) => ({ id: t.id, categoryId: t.categoryId, language: t.language, customerName: t.customerName, durationSec: Math.round(timings[t.id].duration) })),
  };
}
export type Workspace = Awaited<ReturnType<typeof getWorkspace>>;
