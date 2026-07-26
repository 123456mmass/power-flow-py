import type { Metadata } from "next";

import { CompareWorkspace } from "@/components/compare/compare-workspace";
import type { RunResultPayload } from "@/lib/domain/types";
import { readResult, readRuns } from "@/server/data";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ runs?: string }>;
}) {
  const params = await searchParams;
  const ids = (params.runs ?? "").split(",").filter(Boolean).slice(0, 5);
  const [loadedPayloads, candidatePage] = await Promise.all([
    Promise.all(ids.map((id) => readResult(id))),
    readRuns({ pageSize: 100, status: ["converged", "failed", "cancelled"] }),
  ]);
  const payloads = loadedPayloads.filter((payload): payload is RunResultPayload => payload !== null);
  const candidates = candidatePage.items;

  return <CompareWorkspace payloads={payloads} candidates={candidates} />;
}
