"use client";

import { Activity, AudioWaveform, BarChart3, ChevronsUpDown, ClipboardCheck, CreditCard, KeyRound, LayoutDashboard, LogOut, Phone, Settings, Tags, UserCog, Users, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { AgentAvatar } from "@/components/app/bits";
import { signInAs, signOut } from "@/components/app/session";
import { BRAND } from "@/config/brand";
import type { Role } from "@/lib/domain";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type Me = { id: string; name: string; email: string | null; role: Role };
type DemoUser = { id: string; name: string; role: Role };

export function AppSidebar({ me, demoUsers }: { me: Me; demoUsers: DemoUser[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const isMember = me.role === "member";

  const main: NavItem[] = isMember
    ? [
        { href: "/platform", label: "My platform", icon: LayoutDashboard },
        { href: "/conversations/all", label: "My conversations", icon: Phone },
        { href: `/people/${me.id}`, label: "My report card", icon: ClipboardCheck },
      ]
    : [
        { href: "/platform", label: "Platform", icon: LayoutDashboard },
        { href: "/conversations", label: "Conversations", icon: Phone },
        { href: "/analytics", label: "Analytics", icon: BarChart3 },
        { href: "/people", label: "People", icon: Users },
        { href: "/cohorts", label: "Cohorts", icon: UsersRound },
        { href: "/audits", label: "Audits", icon: ClipboardCheck },
      ];
  const workspace: NavItem[] = isMember
    ? []
    : [
        { href: "/workspace/users", label: "Users", icon: UserCog },
        { href: "/workspace/tags", label: "Tags", icon: Tags },
        { href: "/workspace/billing", label: "Billing", icon: CreditCard },
        { href: "/workspace/integrations", label: "Integrations", icon: KeyRound },
        { href: "/workspace/pipeline", label: "Pipeline", icon: Activity },
      ];
  const active = (href: string) => pathname === href || (href !== "/platform" && pathname.startsWith(`${href}/`)) || (href === "/conversations" && pathname.startsWith("/conversations"));

  const switchTo = async (id: string) => {
    await signInAs(id);
    qc.clear();
    router.push("/platform");
    router.refresh();
  };

  const renderItems = (items: NavItem[]) =>
    items.map((i) => (
      <SidebarMenuItem key={i.href}>
        <SidebarMenuButton isActive={active(i.href)} tooltip={i.label} render={<Link href={i.href} />} className="h-10 data-active:font-medium">
          <i.icon className="size-4" />
          <span>{i.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    ));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <Link href="/platform" className="flex items-center gap-3 overflow-hidden">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <AudioWaveform className="size-5" />
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate font-semibold leading-tight">{BRAND.name}</span>
            <span className="block text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Conversation analytics</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(main)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {workspace.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {renderItems(workspace)}
                {renderItems([{ href: "/settings", label: "Settings", icon: Settings }])}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="h-14 border bg-sidebar-accent/40" />}>
            <AgentAvatar name={me.name} size="sm" />
            <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
              <span className="block truncate text-sm font-medium">{me.name}</span>
              <span className="block truncate text-xs capitalize text-muted-foreground">{me.role}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>View the demo as…</DropdownMenuLabel>
              {demoUsers.filter((u) => u.id !== me.id).map((u) => (
                <DropdownMenuItem key={u.id} onClick={() => switchTo(u.id)}>
                  <AgentAvatar name={u.name} size="sm" />
                  <span className="flex-1 truncate">{u.name}</span>
                  <span className="text-xs capitalize text-muted-foreground">{u.role}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={async () => { await signOut(); qc.clear(); router.push("/login"); router.refresh(); }}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
