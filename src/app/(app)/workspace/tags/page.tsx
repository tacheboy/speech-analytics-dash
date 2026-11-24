"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DemoBadge, PageHeader, Panel } from "@/components/app/bits";
import { useWorkspace } from "@/lib/api-client";

type Tag = { id: string; slug: string; displayName: string };

export default function TagsPage() {
  const { data: ws } = useWorkspace();
  return ws ? <TagList initial={ws.tags} /> : null;
}

function TagList({ initial }: { initial: Tag[] }) {
  const [tags, setTags] = useState<Tag[]>(initial);
  const [name, setName] = useState("");
  return (
    <>
      <PageHeader title="Tags" description="Labels that make calls easier to find, filter and analyze." actions={<DemoBadge />} />
      <Panel title="Workspace tags" actions={
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; setTags((t) => [...t, { id: `local_${Date.now()}`, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), displayName: name.trim() }]); setName(""); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag name" className="h-8 w-48" aria-label="New tag name" />
          <Button size="sm" type="submit" className="gap-1"><Plus className="size-3.5" />Create</Button>
        </form>}>
        <ul className="divide-y text-sm">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3">
              <span><span className="block font-medium">{t.displayName}</span><code className="text-xs text-muted-foreground">{t.slug}</code></span>
              {!t.id.startsWith("local_") && <Link href={`/calls/all?tag=${t.id}`} className="text-primary hover:underline">View calls</Link>}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
