import type { Metadata } from "next";

import { AnalysisWorkspace } from "@/components/analysis/analysis-workspace";
import {
  DEFAULT_CASE,
  DEFAULT_IBR_OPTIONS,
  DEFAULT_PF_OPTIONS,
  DEFAULT_SSSA_OPTIONS,
  DEFAULT_TS_OPTIONS,
  defaultModelFor,
  findCase,
} from "@/lib/domain/catalog";
import { ANALYSIS_KINDS, type AnalysisConfig, type AnalysisKind } from "@/lib/domain/types";
import { getSessionUser } from "@/server/auth/session";
import { readPresets, readRun } from "@/server/data";

export const metadata: Metadata = { title: "New analysis" };
export const dynamic = "force-dynamic";

function isAnalysis(value: string | undefined): value is AnalysisKind {
  return value !== undefined && (ANALYSIS_KINDS as readonly string[]).includes(value);
}

function defaultConfig(analysis: AnalysisKind, caseId: string): AnalysisConfig {
  switch (analysis) {
    case "pf":
      return { analysis, case: caseId, options: { ...DEFAULT_PF_OPTIONS } };
    case "sssa":
      return { analysis, case: caseId, options: { ...DEFAULT_SSSA_OPTIONS, model: defaultModelFor("sssa", caseId) } };
    case "ts":
      return { analysis, case: caseId, options: { ...DEFAULT_TS_OPTIONS, model: defaultModelFor("ts", caseId) } };
    case "ibr":
      return {
        analysis,
        case: caseId,
        options: {
          ...DEFAULT_IBR_OPTIONS,
          ...(caseId.endsWith("_switch") ? { t_end: 6, dt: 0.002 } : {}),
        },
      };
  }
}

export default async function NewAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ analysis?: string; case?: string; from?: string; preset?: string }>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();
  const presets = await readPresets();

  let initialConfig: AnalysisConfig;
  const source = params.from ? await readRun(params.from) : null;
  if (source) {
    initialConfig = source.config;
  } else {
    const analysis: AnalysisKind = isAnalysis(params.analysis) ? params.analysis : "pf";
    const requested = params.case && findCase(params.case) ? params.case : DEFAULT_CASE[analysis];
    const descriptor = findCase(requested);
    const caseId = descriptor?.analyses.includes(analysis) ? requested : DEFAULT_CASE[analysis];
    initialConfig = defaultConfig(analysis, caseId);
  }

  const canSubmit = user?.role === "engineer" || user?.role === "admin";

  return (
    <AnalysisWorkspace
      initialConfig={initialConfig}
      presets={presets}
      canSubmit={canSubmit}
      {...(params.from ? { sourceRunId: params.from } : {})}
    />
  );
}
