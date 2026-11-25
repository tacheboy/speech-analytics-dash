import { asc } from "drizzle-orm";
import { AudioWaveform } from "lucide-react";
import { BRAND } from "@/config/brand";
import { db, schema } from "@/server/db/client";
import { LoginPicker } from "./login-picker";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic"; // lists users from the database at request time

export default async function LoginPage() {
  const users = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, teamId: schema.users.teamId }).from(schema.users).orderBy(asc(schema.users.name));
  const teams = await db.select().from(schema.teams);
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><AudioWaveform className="size-6" /></span>
          <div>
            <p className="text-lg font-semibold">{BRAND.name}</p>
            <p className="text-sm text-muted-foreground">{BRAND.tagline}</p>
          </div>
        </div>
        <h1 className="text-2xl font-semibold">Sign in to the demo</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">Pick a seeded user. Each role sees a different product: admins and managers see the whole floor; members only see their own conversations.</p>
        <LoginPicker users={users} teams={teams.map((t) => ({ id: t.id, name: t.name }))} />
      </div>
    </div>
  );
}
