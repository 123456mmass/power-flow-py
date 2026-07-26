import { Skeleton, TableSkeleton } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";

export default function DashboardLoading() {
  return (
    <div className="space-y-3 p-3" aria-busy="true">
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Panel key={index} className="p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Panel>
        ))}
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        <Panel>
          <Skeleton className="m-2 h-[140px]" />
        </Panel>
        <Panel>
          <Skeleton className="m-2 h-[140px]" />
        </Panel>
      </div>
      <Panel>
        <TableSkeleton rows={8} columns={7} />
      </Panel>
    </div>
  );
}
