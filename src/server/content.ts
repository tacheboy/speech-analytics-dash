import fs from "node:fs";
import path from "node:path";
import { rubricSchema, templateSchema, type CallTemplate, type Rubric } from "@/lib/domain";

const ROOT = path.join(process.cwd(), "content");

export function loadRubrics(): Rubric[] {
  const dir = path.join(ROOT, "rubrics");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => rubricSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))));
}

export type Timings = Record<string, { duration: number; segments: { start: number; end: number }[] }>;

export function loadTimings(): Timings {
  const f = path.join(ROOT, "generated", "timings.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
}

export function loadTemplates(): CallTemplate[] {
  const dir = path.join(ROOT, "call-templates");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const parsed = templateSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`${f}: ${parsed.error.message}`);
      return parsed.data;
    });
}
