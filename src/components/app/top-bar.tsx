"use client";

import { Home, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Fragment } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useWorkspace } from "@/lib/api-client";

const LABELS: Record<string, string> = {
  platform: "Platform", conversations: "Conversations", analytics: "Analytics", people: "People", cohorts: "Cohorts", audits: "Audits",
  workspace: "Workspace", users: "Users", tags: "Tags", billing: "Billing", integrations: "Integrations", pipeline: "Pipeline", settings: "Settings",
  configuration: "Configuration", all: "All conversations", org: "Organization", category: "Category", team: "Cohort", agent: "Person",
};

export function TopBar() {
  const pathname = usePathname();
  const { data: ws } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  const parts = pathname.split("/").filter(Boolean);
  const name = (seg: string) =>
    LABELS[seg] ?? ws?.categories.find((c) => c.id === seg)?.name ?? ws?.cohorts.find((t) => t.id === seg)?.name ?? ws?.people.find((a) => a.id === seg)?.name ?? (seg.startsWith("conv_") ? "Conversation" : seg);
  const crumbs = parts
    .map((seg, i) => ({ seg, href: "/" + parts.slice(0, i + 1).join("/") }))
    .filter((c, i) => !(parts[0] === "analytics" && i === 1)); // hide the dimension segment

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur" style={{ top: "env(safe-area-inset-top, 0px)" }}>
      <SidebarTrigger />
      <div className="h-5 w-px bg-border" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/platform" aria-label="Home" />}><Home className="size-4" /></BreadcrumbLink>
          </BreadcrumbItem>
          {crumbs.map((c, i) => (
            <Fragment key={c.href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                {i === crumbs.length - 1 ? (
                  <BreadcrumbPage className="truncate">{name(c.seg)}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink className="truncate" render={<Link href={c.href} />}>{name(c.seg)}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
        <Sun className="hidden size-4 dark:block" />
        <Moon className="size-4 dark:hidden" />
      </Button>
    </header>
  );
}
