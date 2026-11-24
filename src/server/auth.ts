import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/server/db/client";
import type { Role } from "@/lib/domain";

export type Actor = { userId: string; orgId: string; role: Role; name: string };
export const DEMO_COOKIE = "demo_user";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Demo auth: a seeded user id in a cookie (set on /login), or `x-api-key` which acts as the org admin. */
export async function getActor(req?: Request): Promise<Actor> {
  const key = req?.headers.get("x-api-key") ?? req?.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  let userId: string | undefined;
  if (key) {
    if (key !== process.env.DEMO_API_KEY) throw new ApiError(401, "unauthorized", "Invalid API key");
    userId = "u_admin";
  } else {
    userId = (await cookies()).get(DEMO_COOKIE)?.value;
  }
  if (!userId) throw new ApiError(401, "unauthorized", "Sign in or pass x-api-key");
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new ApiError(401, "unauthorized", "Unknown user");
  return { userId: u.id, orgId: u.orgId, role: u.role, name: u.name };
}
