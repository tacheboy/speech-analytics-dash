"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { AgentAvatar, DemoBadge, PageHeader, Panel } from "@/components/app/bits";
import { useWorkspace } from "@/lib/api-client";

export default function SettingsPage() {
  const { data: ws } = useWorkspace();
  const { resolvedTheme, setTheme } = useTheme();
  if (!ws) return null;
  return (
    <>
      <PageHeader title="Settings" description="Your account and preferences." actions={<DemoBadge />} />
      <div className="grid max-w-3xl gap-5">
        <Panel title="Profile">
          <div className="flex items-center gap-4"><AgentAvatar name={ws.me.name} size="lg" /><div><p className="font-medium">{ws.me.name}</p><p className="text-sm text-muted-foreground">{ws.me.email} · <span className="capitalize">{ws.me.role}</span> at {ws.org.name}</p></div></div>
        </Panel>
        <Panel title="Appearance">
          <div className="flex gap-2">{(["dark", "light"] as const).map((t) => <Button key={t} variant={resolvedTheme === t ? "default" : "outline"} onClick={() => setTheme(t)} className="capitalize">{t}</Button>)}</div>
        </Panel>
        <Panel title="Sign-in methods"><p className="text-sm text-muted-foreground">This demo uses seeded users without passwords. Production would use SSO (Google / Microsoft) or email + password.</p></Panel>
      </div>
    </>
  );
}
