import { eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app/app-sidebar";
import { TopBar } from "@/components/app/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { DEMO_COOKIE } from "@/server/auth";
import { db, schema } from "@/server/db/client";

const DEMO_SWITCH = ["u_admin", "u_mgr_south", "u_mgr_north", "u_karthik_subramanian", "u_amit_chauhan", "u_kavya_hegde"];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const userId = (await cookies()).get(DEMO_COOKIE)?.value;
  const me = userId ? (await db.select().from(schema.users).where(eq(schema.users.id, userId)))[0] : undefined;
  if (!me) redirect("/login");
  const demoUsers = await db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role }).from(schema.users).where(inArray(schema.users.id, DEMO_SWITCH));
  return (
    <SidebarProvider>
      <AppSidebar me={me} demoUsers={demoUsers.sort((a, b) => DEMO_SWITCH.indexOf(a.id) - DEMO_SWITCH.indexOf(b.id))} />
      <SidebarInset className="min-w-0">
        <TopBar />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
