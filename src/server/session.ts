import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Sign-in sessions: a stateless, HMAC-signed cookie (userId + expiry), so there's no session table.
 * Two ways to get one:
 * - password (production): email + password, scrypt-hashed in users.password_hash
 * - demo login (DEMO_LOGIN=true, the default outside production): pick any seeded user, no password
 */
export const SESSION_COOKIE = "session";
const TTL_SEC = 30 * 86400;
const secret = () => process.env.APP_SECRET ?? process.env.DEMO_API_KEY ?? "dev-secret";

export const demoLogin = () => (process.env.DEMO_LOGIN ? process.env.DEMO_LOGIN === "true" : process.env.NODE_ENV !== "production");

const mac = (payload: string) => createHmac("sha256", secret()).update(`session:${payload}`).digest("base64url");

export function signSession(userId: string) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + TTL_SEC}`;
  return { value: `${payload}.${mac(payload)}`, maxAge: TTL_SEC };
}

export function readSession(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 1) return null;
  const payload = value.slice(0, i), sig = value.slice(i + 1);
  const expected = mac(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const j = payload.lastIndexOf(".");
  const userId = payload.slice(0, j), exp = Number(payload.slice(j + 1));
  return exp > Date.now() / 1000 ? userId : null;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(password, salt, 32).toString("base64")}`;
}

export function verifyPassword(password: string, stored: string | null) {
  const [kind, salt, hash] = stored?.split("$") ?? [];
  if (kind !== "scrypt" || !salt || !hash) return false;
  const got = scryptSync(password, Buffer.from(salt, "base64"), 32);
  const want = Buffer.from(hash, "base64");
  return got.length === want.length && timingSafeEqual(got, want);
}
