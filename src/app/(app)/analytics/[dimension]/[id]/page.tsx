"use client";

import { notFound, useParams } from "next/navigation";
import { AnalyticsView } from "@/components/app/analytics-view";

const DIMENSIONS = ["org", "category", "team", "agent"] as const;

export default function AnalyticsPage() {
  const { dimension, id } = useParams<{ dimension: string; id: string }>();
  if (!DIMENSIONS.includes(dimension as (typeof DIMENSIONS)[number])) notFound();
  return <AnalyticsView dimension={dimension as (typeof DIMENSIONS)[number]} id={dimension === "org" ? null : id} />;
}
