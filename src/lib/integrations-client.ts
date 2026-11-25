"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiKeyRow, DeliveryRow, WebhookRow } from "@/server/external/manage";

/** Serialised over JSON: dates arrive as strings. */
type Json<T> = { [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K] extends (infer U)[] ? Json<U>[] : T[K] };
export type ApiKey = Json<ApiKeyRow>;
export type Delivery = Json<DeliveryRow>;
export type WebhookEndpoint = Omit<Json<WebhookRow>, "deliveries"> & { deliveries: Delivery[] };
export type CreatedKey = { id: string; name: string; prefix: string; createdAt: string; key: string };
export type CreatedWebhook = { id: string; url: string; events: string[]; active: boolean; createdAt: string; secret: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/integrations${path}`, { ...init, headers: init?.body ? { "content-type": "application/json" } : undefined });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? res.statusText);
  return body.data as T;
}

const KEYS = ["integrations", "keys"];
const HOOKS = ["integrations", "webhooks"];

export const useApiKeys = () => useQuery({ queryKey: KEYS, queryFn: () => api<ApiKey[]>("/keys") });

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<CreatedKey>("/keys", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS }),
  });
}

/** Polls while the screen is open so deliveries from calls finishing elsewhere show up. */
export const useWebhooks = () => useQuery({ queryKey: HOOKS, queryFn: () => api<WebhookEndpoint[]>("/webhooks"), refetchInterval: 10_000 });

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; events: string[] }) => api<CreatedWebhook>("/webhooks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HOOKS }),
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; url?: string; events?: string[]; active?: boolean }) => api(`/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HOOKS }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/webhooks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HOOKS }),
  });
}

export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Delivery>(`/webhooks/${id}/test`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: HOOKS }),
  });
}
