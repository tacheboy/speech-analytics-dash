import { and, eq } from "drizzle-orm";
import type { Rubric } from "@/lib/domain";
import { db, schema } from "@/server/db/client";

/** Published rubric versions are immutable, so they can be cached forever in-process. */
const cache = new Map<string, Rubric>();

export async function rubricAt(categoryId: string, version: number): Promise<Rubric | null> {
  const k = `${categoryId}@${version}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const [row] = await db
    .select({ rubric: schema.rubricVersions.rubric })
    .from(schema.rubricVersions)
    .where(and(eq(schema.rubricVersions.categoryId, categoryId), eq(schema.rubricVersions.version, version)));
  if (!row) return null;
  cache.set(k, row.rubric);
  return row.rubric;
}

/** Rubric for a conversation: the version it was scored with, else the category's current one. */
export async function rubricFor(category: { id: string; rubric: Rubric }, version: number) {
  return (await rubricAt(category.id, version)) ?? category.rubric;
}
