import { z } from "zod";

/** Query of the UI-only dashboard composite (/api/internal/dashboard). The public API contract is in ./contract.ts. */
export const dashboardQuery = z.object({
  dimension: z.enum(["org", "category", "team", "agent"]).default("org"),
  id: z.string().optional(),
  categoryId: z.string().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type DashboardQuery = z.input<typeof dashboardQuery>;
