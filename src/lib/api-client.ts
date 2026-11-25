"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Conversation, List, ListConversationsQuery, ScorecardPatchBody } from "@/lib/contract";
import type { DashboardQuery } from "@/lib/contracts";
import type { Dashboard } from "@/server/services/dashboard";
import type { Workspace } from "@/server/services/workspace";

/**
 * The UI talks to the same public API as customers (/api/v1), with its session cookie.
 * Only UI-shaped composites (workspace bootstrap, the dashboard) live under /api/internal.
 */
export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(init?.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    // session expired: leave the app shell entirely (outside React, so no router here)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new ApiClientError(res.status, body?.error?.code ?? "error", body?.error?.message ?? res.statusText);
  }
  return body as T;
}

export const useWorkspace = () => useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/internal/workspace"), staleTime: 5 * 60_000 });

const busy = (c: Conversation) => c.status === "queued" || c.status === "processing";

export function useConversations(query: ListConversationsQuery, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: ["conversations", query],
    queryFn: () => api<List<Conversation>>(`/api/v1/conversations${qs(query)}`),
    placeholderData: keepPreviousData,
    // poll only while something on screen is still in the pipeline
    refetchInterval: (q) => (opts?.poll !== false && q.state.data?.data.some(busy) ? 3000 : false),
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: ["conversation", id],
    queryFn: () => api<Conversation>(`/api/v1/conversations/${id}`),
    refetchInterval: (q) => (q.state.data && busy(q.state.data) ? 2500 : false),
  });
}

export const useDashboard = (query: DashboardQuery, enabled = true) =>
  useQuery({ queryKey: ["dashboard", query], queryFn: () => api<Dashboard>(`/api/internal/dashboard${qs(query)}`), placeholderData: keepPreviousData, enabled });

function useInvalidateAfter(id: string) {
  const qc = useQueryClient();
  return (data?: Conversation) => {
    if (data) qc.setQueryData(["conversation", id], data);
    else qc.invalidateQueries({ queryKey: ["conversation", id] });
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function useAuditScorecard(id: string) {
  const after = useInvalidateAfter(id);
  return useMutation({
    mutationFn: (body: ScorecardPatchBody) => api<Conversation>(`/api/v1/conversations/${id}/scorecard`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (data) => after(data),
  });
}

export function useReanalyze(id: string) {
  const after = useInvalidateAfter(id);
  return useMutation({
    mutationFn: () => api<Conversation>(`/api/v1/conversations/${id}/analyze`, { method: "POST", body: "{}" }),
    onSuccess: () => after(),
  });
}

/** Upload = the public flow: POST /uploads → PUT the file → POST /conversations with the audioUrl. */
export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { categoryId: string; personId: string; sampleId?: string; file?: File }) => {
      let audioUrl: string | undefined;
      if (input.file) {
        const type = input.file.type || "audio/mpeg";
        const up = await api<{ uploadUrl: string; audioUrl: string; headers: Record<string, string> }>("/api/v1/uploads", { method: "POST", body: JSON.stringify({ fileName: input.file.name, contentType: type, sizeBytes: input.file.size }) });
        const put = await fetch(up.uploadUrl, { method: "PUT", body: input.file, headers: up.headers });
        if (!put.ok) throw new ApiClientError(put.status, "upload_failed", "The file could not be uploaded");
        audioUrl = up.audioUrl;
      }
      return api<Conversation>("/api/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ categoryId: input.categoryId, personId: input.personId, ...(input.sampleId ? { sampleId: input.sampleId } : { audioUrl }) }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
  });
}
