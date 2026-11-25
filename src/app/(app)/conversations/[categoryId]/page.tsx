"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/bits";
import { ConversationsTable } from "@/components/app/conversations-table";
import { UploadDialog } from "@/components/app/upload-dialog";
import { useWorkspace } from "@/lib/api-client";

export default function CategoryCallsPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { data: ws } = useWorkspace();
  const cat = ws?.categories.find((c) => c.id === categoryId);
  const isMember = ws?.me.role === "member";
  const title = categoryId === "all" ? (isMember ? "My conversations" : "All recordings") : cat?.name ?? "Conversations";
  const description = categoryId === "all" ? (isMember ? "Every conversation of yours that has been analyzed." : "Every conversation across categories.") : cat?.description;
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={!isMember && (
          <>
            <Button variant="outline" className="gap-2" nativeButton={false} render={<Link href={categoryId === "all" ? "/analytics" : `/analytics/category/${categoryId}`} />}><BarChart3 className="size-4" /> View analytics</Button>
            <UploadDialog defaultCategoryId={categoryId} />
          </>
        )}
      />
      <ConversationsTable categoryId={categoryId} />
    </>
  );
}
