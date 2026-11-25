"use client";

import { useParams } from "next/navigation";
import { AnalyticsView } from "@/components/app/analytics-view";
import { useWorkspace } from "@/lib/api-client";

export default function AgentProfilePage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data: ws } = useWorkspace();
  const agent = ws?.agents.find((a) => a.id === agentId);
  const team = ws?.teams.find((t) => t.id === agent?.teamId);
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
