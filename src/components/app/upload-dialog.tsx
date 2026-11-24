"use client";

import { FileAudio, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateCall, useWorkspace } from "@/lib/api-client";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const LANG = { "ta-en": "Tamil–English", "kn-en": "Kannada–English", "hi-en": "Hindi–English" } as const;

function readDuration(file: File) {
  return new Promise<number | undefined>((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => { resolve(Number.isFinite(a.duration) ? Math.max(1, Math.round(a.duration)) : undefined); URL.revokeObjectURL(a.src); };
    a.onerror = () => resolve(undefined);
    a.src = URL.createObjectURL(file);
  });
}

export function UploadDialog({ defaultCategoryId, trigger }: { defaultCategoryId?: string; trigger?: React.ReactElement }) {
  const router = useRouter();
  const { data: ws } = useWorkspace();
  const create = useCreateCall();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState(defaultCategoryId && defaultCategoryId !== "all" ? defaultCategoryId : "");
  const [agentId, setAgentId] = useState("");
  const [mode, setMode] = useState<"sample" | "file">("sample");
  const [sampleId, setSampleId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const agent = ws?.agents.find((a) => a.id === agentId);
  const agentLang = ws?.teams.find((t) => t.id === agent?.teamId)?.language;
  const samples = (ws?.samples ?? []).filter((s) => s.categoryId === categoryId).sort((a, b) => Number(b.language === agentLang) - Number(a.language === agentLang));
  const valid = categoryId && agentId && (mode === "sample" ? sampleId : files.length > 0);

  const addFiles = (list: FileList | null) => {
    const ok = [...(list ?? [])].filter((f) => /\.(mp3|wav|m4a)$/i.test(f.name) && f.size <= 50 * 1024 * 1024);
    if (list && ok.length < list.length) toast.error("Only MP3, WAV or M4A files up to 50 MB are accepted");
    setFiles((prev) => [...prev, ...ok]);
  };

  const submit = async () => {
    try {
      if (mode === "sample") await create.mutateAsync({ categoryId, agentId, sampleId });
      else for (const file of files) await create.mutateAsync({ categoryId, agentId, file, durationSec: await readDuration(file) });
      toast.success(mode === "sample" ? "Call uploaded — analysis takes a few seconds" : `${files.length} recording(s) uploaded — analysis takes a few seconds`);
      setOpen(false);
      setFiles([]);
      setSampleId("");
      router.push(`/calls/${categoryId}?sort=date&order=desc`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
  };

  const catItems = (ws?.categories ?? []).map((c) => ({ value: c.id, label: c.name }));
  const agentItems = (ws?.agents ?? []).map((a) => ({ value: a.id, label: a.name }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger ?? <Button className="gap-2" />}>
        {!trigger && <><Upload className="size-4" /> Upload call</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload call recording</DialogTitle>
          <DialogDescription>The call is scored against the category’s rubric. Status moves from Processing to Analyzed in a few seconds.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">Category
              <Select items={catItems} value={categoryId || null} onValueChange={(v) => { setCategoryId(String(v)); setSampleId(""); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select a category…" /></SelectTrigger>
                <SelectContent>{catItems.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">Agent
              <Select items={agentItems} value={agentId || null} onValueChange={(v) => setAgentId(String(v))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select an agent…" /></SelectTrigger>
                <SelectContent>{agentItems.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>

          <div className="inline-flex w-fit rounded-lg border p-0.5 text-sm" role="tablist">
            {(["sample", "file"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn("rounded-md px-3 py-1.5", mode === m ? "bg-secondary font-medium" : "text-muted-foreground")}>
                {m === "sample" ? "Demo recording" : "Your own file"}
              </button>
            ))}
          </div>

          {mode === "sample" ? (
            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
              {!categoryId && <p className="text-sm text-muted-foreground">Pick a category to see its demo recordings.</p>}
              {samples.map((s) => (
                <button key={s.id} onClick={() => setSampleId(s.id)} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition", sampleId === s.id ? "border-primary bg-primary/10" : "hover:bg-accent/40")}>
                  <FileAudio className="size-4 text-muted-foreground" />
                  <span className="flex-1">Call with {s.customerName}<span className="block text-xs text-muted-foreground">{LANG[s.language]}{s.language === agentLang ? " · matches agent’s floor" : ""}</span></span>
                  <span className="text-xs text-muted-foreground tabular">{fmtDuration(s.durationSec)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                onClick={() => input.current?.click()}
                className={cn("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm", drag ? "border-primary bg-primary/5" : "border-border")}
              >
                <Upload className="size-5 text-muted-foreground" />
                <span className="font-medium">Click or drop recordings</span>
                <span className="text-xs text-muted-foreground">MP3, WAV, M4A up to 50 MB</span>
                <input ref={input} type="file" accept=".mp3,.wav,.m4a,audio/*" multiple hidden onChange={(e) => addFiles(e.target.files)} />
              </div>
              {files.length > 0 && <ul className="mt-2 space-y-1 text-sm">{files.map((f, i) => <li key={i} className="flex justify-between gap-2 text-muted-foreground"><span className="truncate">{f.name}</span><span>{(f.size / 1e6).toFixed(1)} MB</span></li>)}</ul>}
              <p className="mt-2 text-xs text-muted-foreground">No speech-to-text runs in this demo build, so your recording plays back, but its transcript and scores come from a matching demo call and are labelled <em>Simulated</em>.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!valid || create.isPending} onClick={submit}>{create.isPending ? "Uploading…" : "Upload & analyze"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
