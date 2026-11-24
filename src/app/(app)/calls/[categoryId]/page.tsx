"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/bits";
import { CallsTable } from "@/components/app/calls-table";
import { UploadDialog } from "@/components/app/upload-dialog";
import { useWorkspace } from "@/lib/api-client";

export default function CategoryCallsPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const { data: ws } = useWorkspace();
  const cat = ws?.categories.find((c) => c.id === categoryId);
  const isAgent = ws?.me.role === "agent";
  const title = categoryId === "all" ? (isAgent ? "My calls" : "All recordings") : cat?.name ?? "Calls";
  const description = categoryId === "all" ? (isAgent ? "Every call of yours that has been analyzed." : "Every call across categories.") : cat?.description;
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={!isAgent && (
          <>
            <Button variant="outline" className="gap-2" nativeButton={false} render={<Link href={categoryId === "all" ? "/analytics" : `/analytics/category/${categoryId}`} />}><BarChart3 className="size-4" /> View analytics</Button>
            <UploadDialog defaultCategoryId={categoryId} />
          </>
        )}
      />
      <CallsTable categoryId={categoryId} />
    </>
  );
}
