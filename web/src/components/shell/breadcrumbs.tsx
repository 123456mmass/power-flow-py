"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  analysis: "Analysis",
  new: "New analysis",
  runs: "Runs",
  results: "Results",
  compare: "Compare",
  presets: "Presets",
  logs: "Audit logs",
  settings: "Settings",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[11.5px] text-fg-subtle">
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const last = index === segments.length - 1;
          const label = LABELS[segment] ?? segment;
          return (
            <li key={href} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden className="size-3 shrink-0 opacity-60" /> : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-fg-muted">
                  {label}
                </span>
              ) : (
                <Link href={href} className="truncate hover:text-fg hover:underline">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
