"use client";

async function post(body: unknown) {
  const r = await fetch("/api/internal/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? "Sign-in failed");
}

/** Demo login (no password): only accepted by the server when DEMO_LOGIN is on. */
export const signInAs = (userId: string) => post({ userId });
export const signInWithPassword = (email: string, password: string) => post({ email, password });

export async function signOut() {
  await fetch("/api/internal/session", { method: "DELETE" });
}
