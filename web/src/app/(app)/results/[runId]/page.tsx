import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ResultWorkspace } from "@/components/results/result-workspace";
import { readResult, readRun } from "@/server/data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ runId: string }> }): Promise<Metadata> {
  const { runId } = await params;
  const run = await readRun(runId);
  return { title: run ? `Results ${run.id}` : "Results" };
}

export default async function ResultPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = await readRun(runId);
  if (!run) notFound();
  const payload = await readResult(runId);
  // A run that is still streaming has no final result yet; send the user to the monitor.
  if (!payload) redirect(`/runs/${runId}`);

  return <ResultWorkspace payload={payload} />;
}
