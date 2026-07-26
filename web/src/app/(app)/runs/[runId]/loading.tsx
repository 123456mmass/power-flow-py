import { Skeleton } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";

export default function RunLoading() {
  return (
    <div className="space-y-2 p-3" aria-busy="true">
      <Panel className="p-3">
        <Skeleton className="h-5 w-80" />
        <Skeleton className="mt-2 h-3 w-full max-w-xl" />
        <Skeleton className="mt-3 h-1.5 w-full" />
      </Panel>
      <div className="grid gap-2 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Panel>
          <Skeleton className="m-2 h-[16rem]" />
        </Panel>
        <div className="space-y-2">
          <div className="grid gap-2 2xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Panel key={index}>
                <Skeleton className="m-2 h-[200px]" />
              </Panel>
            ))}
          </div>
          <Panel>
            <Skeleton className="m-2 h-[16rem]" />
          </Panel>
        </div>
      </div>
    </div>
  );
}
