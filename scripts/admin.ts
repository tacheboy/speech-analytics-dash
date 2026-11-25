/**
 * Instance administration, for a fresh production install (no demo data):
 *
 *   npm run admin -- org:create --name "Acme Collections" --admin-email ops@acme.in --admin-name "Asha Rao" [--starter]
 *   npm run admin -- user:add --org org_acme --email lead@acme.in --name "QA Lead" --role manager
 *   npm run admin -- user:password --email lead@acme.in
 *   npm run admin -- key:create --org org_acme --name "Dialer" [--scope read]
 *
 * Passwords and API keys are printed once. `--starter` copies the bundled collections rubrics and tag
 * taxonomy into the new org as a starting point (edit them in the UI or with PUT /categories/{id}).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { parseArgs } from "node:util";
import { loadRubrics, loadTagDefs } from "@/server/content";
import { db, schema } from "@/server/db/client";
import { generateApiKey } from "@/server/external/auth";
import { newId } from "@/server/ids";
import { hashPassword } from "@/server/session";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" }, org: { type: "string" }, email: { type: "string" }, role: { type: "string", default: "manager" },
    password: { type: "string" }, scope: { type: "string", default: "write" }, starter: { type: "boolean", default: false },
    "admin-email": { type: "string" }, "admin-name": { type: "string" },
  },
});
const need = (k: keyof typeof values) => {
  const v = values[k];
  if (!v || typeof v !== "string") throw new Error(`--${k} is required`);
  return v;
};
const password = () => values.password ?? randomBytes(12).toString("base64url");

async function createKey(orgId: string, name: string, scope: "read" | "write") {
  const g = generateApiKey();
  await db.insert(schema.apiKeys).values({ id: newId("key"), orgId, name, scope, prefix: g.prefix, hash: g.hash });
  return g.key;
}

async function main() {
  const cmd = positionals[0];
  if (cmd === "org:create") {
    const name = need("name");
    const orgId = `org_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30)}`;
    const pw = password();
    const adminId = newId("per").replace("per_", "usr_");
    await db.transaction(async (tx) => {
      await tx.insert(schema.organizations).values({ id: orgId, name });
      await tx.insert(schema.users).values({ id: adminId, orgId, name: values["admin-name"] ?? "Admin", email: need("admin-email").toLowerCase(), role: "admin", passwordHash: hashPassword(pw) });
      if (values.starter) {
        await tx.insert(schema.tags).values(loadTagDefs().map((t) => ({ id: newId("tag"), orgId, slug: t.slug, displayName: t.displayName, description: t.description ?? null, assignable: t.assignable ?? false })));
        for (const r of loadRubrics()) {
          const id = `${r.id}-${orgId.slice(4, 12)}`.slice(0, 63);
          const rubric = { ...r, id };
          await tx.insert(schema.categories).values({ id, orgId, name: r.name, description: r.description, icon: r.icon, rubric });
          await tx.insert(schema.rubricVersions).values({ categoryId: id, version: 1, rubric, createdBy: adminId });
        }
      }
    });
    const key = await createKey(orgId, "Initial key", "write");
    console.log(`✓ organization ${orgId}\n  admin  ${values["admin-email"]} / ${pw}\n  API key (shown once): ${key}${values.starter ? "\n  starter rubrics and tags copied" : "\n  next: create a category with PUT /api/v1/categories/{id}"}`);
  } else if (cmd === "user:add") {
    const role = values.role as "admin" | "manager" | "member";
    if (!["admin", "manager", "member"].includes(role)) throw new Error("--role is admin | manager | member");
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, need("org")));
    if (!org) throw new Error(`no organization ${values.org}`);
    const pw = password();
    await db.insert(schema.users).values({ id: newId("per").replace("per_", role === "member" ? "per_" : "usr_"), orgId: org.id, name: need("name"), email: need("email").toLowerCase(), role, passwordHash: hashPassword(pw) });
    console.log(`✓ ${role} ${values.email} / ${pw}`);
  } else if (cmd === "user:password") {
    const pw = password();
    const res = await db.update(schema.users).set({ passwordHash: hashPassword(pw), updatedAt: new Date() }).where(eq(schema.users.email, need("email").toLowerCase())).returning({ id: schema.users.id });
    if (!res.length) throw new Error(`no user ${values.email}`);
    console.log(`✓ new password for ${values.email}: ${pw}`);
  } else if (cmd === "key:create") {
    const scope = values.scope === "read" ? "read" : "write";
    console.log(`✓ API key (${scope}, shown once): ${await createKey(need("org"), values.name ?? "API key", scope)}`);
  } else {
    console.log("usage: npm run admin -- org:create | user:add | user:password | key:create  (see scripts/admin.ts)");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
