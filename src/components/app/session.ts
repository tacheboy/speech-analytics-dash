"use client";

export const DEMO_COOKIE = "demo_user";
export function signInAs(userId: string) {
  document.cookie = `${DEMO_COOKIE}=${userId}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
}
export function signOut() {
  document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0`;
}
