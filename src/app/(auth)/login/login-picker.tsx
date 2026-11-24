"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { AgentAvatar, Pill } from "@/components/app/bits";
import { signInAs } from "@/components/app/session";

type U = { id: string; name: string; email: string; role: "admin" | "manager" | "agent"; teamId: string | null };

export function LoginPicker({ users, teams }: { users: U[]; teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const go = (id: string) => {
    signInAs(id);
    router.push("/dashboard");
    router.refresh();
  };
  const staff = users.filter((u) => u.role !== "agent").sort((a) => (a.role === "admin" ? -1 : 1));
  const agents = users.filter((u) => u.role === "agent");
  const Row = ({ u, sub }: { u: U; sub: string }) => (
    <button onClick={() => go(u.id)} className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition hover:border-primary/50 hover:bg-accent/40">
      <AgentAvatar name={u.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{u.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <Pill tone={u.role === "agent" ? "muted" : "primary"} className="capitalize">{u.role}</Pill>
      <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
    </button>
  );
  return (
    <div className="space-y-6">
      <div className="space-y-2">{staff.map((u) => <Row key={u.id} u={u} sub={u.email} />)}</div>
      <details className="group rounded-xl border bg-card/50 p-3">
        <summary className="cursor-pointer px-1 text-sm font-medium">Sign in as an agent ({agents.length})</summary>
        <div className="mt-3 grid gap-2">
          {agents.map((u) => <Row key={u.id} u={u} sub={teams.find((t) => t.id === u.teamId)?.name ?? ""} />)}
        </div>
      </details>
    </div>
  );
}
