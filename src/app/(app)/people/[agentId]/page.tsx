"use client";

import { useParams } from "next/navigation";
import { AnalyticsView } from "@/components/app/analytics-view";
import { useWorkspace } from "@/lib/api-client";

export default function AgentProfilePage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: ws } = useWorkspace();
  const agent = ws?.people.find((a) => a.id === agentId);
  const team = ws?.cohorts.find((t) => t.id === agent?.cohortId);
  const self = ws?.me.id === agentId;
  return (
    <AnalyticsView
      dimension="agent"
      id={agentId}
      title={self ? "My report card" : agent?.name}
      description={self ? "Your strengths, the habits to work on, and how you’re trending." : agent ? `Report card · ${team?.name ?? "No cohort"} · ${agent.email}` : undefined}
    />
  );
}
