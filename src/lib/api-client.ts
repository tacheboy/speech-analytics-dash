"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalyticsQuery, ListCallsQuery, ReviewBody } from "@/lib/contracts";
import type { Analytics } from "@/server/services/analytics";
import type { CallDetail, CallList } from "@/server/services/calls";
import type { Workspace } from "@/server/services/workspace";

export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // session expired: leave the app shell entirely (outside React, so no router here)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 401 && typeof window !== "undefined") window.location.href = "/login";
    throw new ApiClientError(res.status, body?.error?.code ?? "error", body?.error?.message ?? res.statusText);
  }
  return body.data as T;
}

export const useWorkspace = () => useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/workspace"), staleTime: 5 * 60_000 });

export function useCalls(query: ListCallsQuery, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: ["calls", query],
    queryFn: () => api<CallList>(`/calls${qs(query)}`),
    placeholderData: keepPreviousData,
    // poll only while something on screen is still processing
    refetchInterval: (q) => (opts?.poll !== false && q.state.data?.items.some((c) => c.status === "processing") ? 3000 : false),
  });
}

export function useCall(id: string) {
  return useQuery({
    queryKey: ["call", id],
    queryFn: () => api<CallDetail>(`/calls/${id}`),
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 3000 : false),
  });
}

export const useAnalytics = (query: AnalyticsQuery, enabled = true) =>
  useQuery({ queryKey: ["analytics", query], queryFn: () => api<Analytics>(`/analytics${qs(query)}`), placeholderData: keepPreviousData, enabled });

export function useReviewCall(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewBody) => api<CallDetail>(`/calls/${id}/review`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: (data) => {
      qc.setQueryData(["call", id], data);
      qc.invalidateQueries({ queryKey: ["calls"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

export function useCreateCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { categoryId: string; agentId: string; sampleId?: string; file?: File; durationSec?: number }) => {
      if (input.file) {
        const form = new FormData();
        form.set("categoryId", input.categoryId);
        form.set("agentId", input.agentId);
        if (input.durationSec) form.set("durationSec", String(input.durationSec));
        form.set("file", input.file);
        return api<{ callId: string; status: string }>("/calls", { method: "POST", body: form });
      }
      return api<{ callId: string; status: string }>("/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId: input.categoryId, agentId: input.agentId, sampleId: input.sampleId }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calls"] }),
  });
}
