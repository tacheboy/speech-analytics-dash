"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentAvatar, Pill } from "@/components/app/bits";
import { signInAs, signInWithPassword } from "@/components/app/session";

type U = { id: string; name: string; email: string | null; role: "admin" | "manager" | "member"; cohortId: string | null };

export function LoginPicker({ users, teams }: { users: U[]; teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const go = async (id: string) => {
    try {
      await signInAs(id);
      router.push("/platform");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const staff = users.filter((u) => u.role !== "member").sort((a) => (a.role === "admin" ? -1 : 1));
  const agents = users.filter((u) => u.role === "member");
  const Row = ({ u, sub }: { u: U; sub: string }) => (
    <button onClick={() => go(u.id)} className="group flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left transition hover:border-primary/50 hover:bg-accent/40">
      <AgentAvatar name={u.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{u.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      <Pill tone={u.role === "member" ? "muted" : "primary"} className="capitalize">{u.role}</Pill>
      <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
    </button>
  );
  return (
    <div className="space-y-6">
      <div className="space-y-2">{staff.map((u) => <Row key={u.id} u={u} sub={u.email ?? ""} />)}</div>
      <details className="group rounded-xl border bg-card/50 p-3">
        <summary className="cursor-pointer px-1 text-sm font-medium">Sign in as a member ({agents.length})</summary>
        <div className="mt-3 grid gap-2">
          {agents.map((u) => <Row key={u.id} u={u} sub={teams.find((t) => t.id === u.cohortId)?.name ?? ""} />)}
        </div>
      </details>
    </div>
  );
}

/** Production sign-in: email + password (users are created with `npm run admin -- user:add`). */
export function PasswordLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signInWithPassword(email, password);
      router.push("/platform");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border bg-card p-5">
      <label className="grid gap-1.5 text-sm font-medium">Email<Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
      <label className="grid gap-1.5 text-sm font-medium">Password<Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
