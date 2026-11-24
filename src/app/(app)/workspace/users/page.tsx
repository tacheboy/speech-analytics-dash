"use client";

import { MailPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AgentAvatar, DemoBadge, PageHeader, Panel, Pill } from "@/components/app/bits";
import { useWorkspace } from "@/lib/api-client";
import { fmtDate } from "@/lib/format";

export default function UsersPage() {
  const { data: ws } = useWorkspace();
  const [invites, setInvites] = useState<{ email: string; role: string }[]>([{ email: "qa.lead@kaverifinance.in", role: "manager" }]);
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const users = [...(ws?.staff ?? []), ...(ws?.agents ?? [])];
  return (
    <>
      <PageHeader title="Users" description="Who can access the workspace and what they can do." actions={<><DemoBadge />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button className="gap-2" />}><MailPlus className="size-4" /> Invite user</DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Invite a user</DialogTitle></DialogHeader>
            <Input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <p className="text-sm text-muted-foreground">Managers can review calls and see all analytics. Agents only see their own calls.</p>
            <DialogFooter><Button disabled={!/.+@.+\..+/.test(email)} onClick={() => { setInvites((i) => [...i, { email, role: "manager" }]); setEmail(""); setOpen(false); toast.success("Invitation created (demo — no email sent)"); }}>Send invite</Button></DialogFooter>
          </DialogContent>
        </Dialog></>} />
      <div className="space-y-5">
        <Panel title="Members" description={`${users.length} people`} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-5">User</TableHead><TableHead>Role</TableHead><TableHead>Team</TableHead><TableHead className="pr-5">Joined</TableHead></TableRow></TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="py-3 pl-5"><div className="flex items-center gap-3"><AgentAvatar name={u.name} size="sm" /><div><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></div></div></TableCell>
                    <TableCell><Pill tone={u.role === "admin" ? "primary" : u.role === "manager" ? "info" : "muted"} className="capitalize">{u.role}</Pill></TableCell>
                    <TableCell className="text-muted-foreground">{ws?.teams.find((t) => t.id === u.teamId)?.name ?? "—"}</TableCell>
                    <TableCell className="pr-5 text-muted-foreground tabular">{fmtDate(u.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
        <Panel title="Pending invitations">
          {invites.length ? <ul className="divide-y text-sm">{invites.map((i) => <li key={i.email} className="flex items-center justify-between py-2.5"><span>{i.email}</span><span className="flex items-center gap-2"><Pill className="capitalize">{i.role}</Pill><Button variant="ghost" size="sm" onClick={() => setInvites((x) => x.filter((y) => y.email !== i.email))}>Cancel</Button></span></li>)}</ul> : <p className="text-sm text-muted-foreground">No pending invitations.</p>}
        </Panel>
      </div>
    </>
  );
}
