import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Opaque, prefixed ids: conv_8Kf2…, per_…, coh_…, anl_…, evt_…, wh_…, key_… */
export function newId(prefix: "conv" | "per" | "coh" | "anl" | "evt" | "wh" | "key" | "dlv" | "tag", len = 14) {
  const bytes = randomBytes(len);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % 62];
  return `${prefix}_${s}`;
}

/** `ext:<externalId>` addresses an object by the customer's own id. */
export const parseRef = (ref: string) => (ref.startsWith("ext:") ? { externalId: ref.slice(4) } : { id: ref });
