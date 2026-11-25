import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { db, schema } from "@/server/db/client";
import { demoLogin, SESSION_COOKIE, signSession, verifyPassword } from "@/server/session";

const err = (status: number, code: string, message: string) => Response.json({ error: { type: status === 401 ? "authentication" : "invalid_request", code, message } }, { status });

/** Sign in: { email, password }, or { userId } when demo login is enabled. Sets a signed session cookie. */
export async function POST(req: Request) {
  const body = z.union([z.object({ email: z.string(), password: z.string() }), z.object({ userId: z.string() })]).safeParse(await req.json().catch(() => null));
  if (!body.success) return err(400, "invalid_request", "Send { email, password }");
  let userId: string;
  if ("userId" in body.data) {
    if (!demoLogin()) return err(401, "demo_login_disabled", "Demo login is disabled on this server");
    userId = body.data.userId;
  } else {
    const [u] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${body.data.email.trim().toLowerCase()}`);
    // the same answer for an unknown email and a wrong password
    if (!u || u.deactivatedAt || !verifyPassword(body.data.password, u.passwordHash)) return err(401, "invalid_credentials", "Wrong email or password");
    userId = u.id;
  }
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId));
  if (!u) return err(401, "unknown_user", "Unknown user");
  const s = signSession(u.id);
  const secure = process.env.NODE_ENV === "production" && process.env.ALLOW_HTTP_COOKIES !== "true";
  (await cookies()).set(SESSION_COOKIE, s.value, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: s.maxAge });
  return new Response(null, { status: 204 });
}

/** Sign out: expires the session cookie. */
export async function DELETE() {
  (await cookies()).set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return new Response(null, { status: 204 });
}
