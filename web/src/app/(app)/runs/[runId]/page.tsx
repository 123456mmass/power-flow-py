import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RunMonitor } from "@/components/runs/run-monitor";
import { getSessionUser } from "@/server/auth/session";
import { readRun } from "@/server/data";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ runId: string }>;
}): Promise<Metadata> {
  const { runId } = await params;
  const run = await readRun(runId);
  return { title: run ? `${run.id} · ${run.caseName}` : "Run" };
}

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await readRun(runId);
  if (!run) notFound();
  const user = await getSessionUser();

  return <RunMonitor initial={run} canMutate={user?.role === "engineer" || user?.role === "admin"} />;
}
