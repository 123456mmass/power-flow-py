"use client";

import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileJson,
  Play,
  RotateCcw,
  Save,
  Square,
  Terminal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge, ErrorState } from "@/components/ui/feedback";
import { Checkbox, Field, NumberInput, Select, TextInput } from "@/components/ui/inputs";
import { Dialog } from "@/components/ui/overlay";
import { KeyValue, Panel, PanelHeader } from "@/components/ui/panel";
import {
  ANALYSIS_DESCRIPTIONS,
  ANALYSIS_LABELS,
  DEFAULT_IBR_OPTIONS,
  DEFAULT_PF_OPTIONS,
  DEFAULT_SSSA_OPTIONS,
  DEFAULT_TS_OPTIONS,
  IBR_PRODUCT_LABELS,
  INTEGRATOR_LABELS,
  MODEL_LABELS,
  PF_MAX_ITER_DEFAULTS,
  PF_METHOD_LABELS,
  casesForAnalysis,
  defaultModelFor,
  findCase,
  ibrProductsFor,
  modelsFor,
  pfMethodsFor,
} from "@/lib/domain/catalog";
import { estimatedSteps, toCliCommand } from "@/lib/domain/cli";
import { validateConfig } from "@/lib/domain/config-schema";
import { ANALYSIS_KINDS } from "@/lib/domain/types";
import type {
  AnalysisConfig,
  AnalysisKind,
  DynamicModel,
  IbrProduct,
  Integrator,
  PfMethod,
  Preset,
  RunDetail,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { downloadBlob } from "@/lib/utils/format";

interface Texts {
  pf: Record<"tolerance" | "max_iter" | "acceleration" | "q_limit_tolerance" | "max_q_limit_switches", string>;
  ts: Record<"t_end" | "dt" | "fault_bus" | "t_fault" | "t_clear", string>;
  ibr: Record<
    "t_end" | "dt" | "fault_on" | "fault_clear" | "fault_reactance" | "step_on" | "step_dv" | "step_dphase_deg" | "sweep",
    string
  >;
}

function defaultTexts(): Texts {
  return {
    pf: {
      tolerance: String(DEFAULT_PF_OPTIONS.tolerance),
      max_iter: String(DEFAULT_PF_OPTIONS.max_iter),
      acceleration: String(DEFAULT_PF_OPTIONS.acceleration),
      q_limit_tolerance: String(DEFAULT_PF_OPTIONS.q_limit_tolerance),
      max_q_limit_switches: String(DEFAULT_PF_OPTIONS.max_q_limit_switches),
    },
    ts: {
      t_end: String(DEFAULT_TS_OPTIONS.t_end),
      dt: String(DEFAULT_TS_OPTIONS.dt),
      fault_bus: "",
      t_fault: String(DEFAULT_TS_OPTIONS.t_fault),
      t_clear: String(DEFAULT_TS_OPTIONS.t_clear),
    },
    ibr: {
      t_end: String(DEFAULT_IBR_OPTIONS.t_end),
      dt: String(DEFAULT_IBR_OPTIONS.dt),
      fault_on: String(DEFAULT_IBR_OPTIONS.fault_on),
      fault_clear: String(DEFAULT_IBR_OPTIONS.fault_clear),
      fault_reactance: String(DEFAULT_IBR_OPTIONS.fault_reactance),
      step_on: String(DEFAULT_IBR_OPTIONS.step_on),
      step_dv: String(DEFAULT_IBR_OPTIONS.step_dv),
      step_dphase_deg: String(DEFAULT_IBR_OPTIONS.step_dphase_deg),
      sweep: DEFAULT_IBR_OPTIONS.sssa_load_percentages.join(", "),
    },
  };
}

function parse(value: string): number {
  const trimmed = value.trim();
  if (trimmed === "") return Number.NaN;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function textsFromConfig(config: AnalysisConfig): Texts {
  const base = defaultTexts();
  if (config.analysis === "pf") {
    base.pf = {
      tolerance: String(config.options.tolerance),
      max_iter: String(config.options.max_iter),
      acceleration: String(config.options.acceleration),
      q_limit_tolerance: String(config.options.q_limit_tolerance),
      max_q_limit_switches: String(config.options.max_q_limit_switches),
    };
  }
  if (config.analysis === "ts") {
    base.ts = {
      t_end: String(config.options.t_end),
      dt: String(config.options.dt),
      fault_bus: config.options.fault_bus === null ? "" : String(config.options.fault_bus),
      t_fault: String(config.options.t_fault),
      t_clear: String(config.options.t_clear),
    };
  }
  if (config.analysis === "ibr") {
    base.ibr = {
      t_end: String(config.options.t_end),
      dt: String(config.options.dt),
      fault_on: String(config.options.fault_on),
      fault_clear: String(config.options.fault_clear),
      fault_reactance: String(config.options.fault_reactance),
      step_on: String(config.options.step_on),
      step_dv: String(config.options.step_dv),
      step_dphase_deg: String(config.options.step_dphase_deg),
      sweep: config.options.sssa_load_percentages.join(", "),
    };
  }
  return base;
}

export interface AnalysisWorkspaceProps {
  initialConfig: AnalysisConfig;
  presets: Preset[];
  canSubmit: boolean;
  sourceRunId?: string;
}

export function AnalysisWorkspace({ initialConfig, presets, canSubmit, sourceRunId }: AnalysisWorkspaceProps) {
  const router = useRouter();

  const [analysis, setAnalysis] = useState<AnalysisKind>(initialConfig.analysis);
  const [caseByAnalysis, setCaseByAnalysis] = useState<Record<AnalysisKind, string>>({
    pf: initialConfig.analysis === "pf" ? initialConfig.case : "ieee14",
    sssa: initialConfig.analysis === "sssa" ? initialConfig.case : "rts24",
    ts: initialConfig.analysis === "ts" ? initialConfig.case : "kundur",
    ibr: initialConfig.analysis === "ibr" ? initialConfig.case : "ieee14_switch",
  });
  const [pfMethod, setPfMethod] = useState<PfMethod>(
    initialConfig.analysis === "pf" ? initialConfig.options.pf_method : DEFAULT_PF_OPTIONS.pf_method,
  );
  const [enforceQLimits, setEnforceQLimits] = useState(
    initialConfig.analysis === "pf" ? initialConfig.options.enforce_q_limits : true,
  );
  const [model, setModel] = useState<DynamicModel>(
    initialConfig.analysis === "sssa" || initialConfig.analysis === "ts"
      ? initialConfig.options.model
      : defaultModelFor(analysis, caseByAnalysis[analysis]),
  );
  const [integrator, setIntegrator] = useState<Integrator>(
    initialConfig.analysis === "ts" ? initialConfig.options.integrator : DEFAULT_TS_OPTIONS.integrator,
  );
  const [ibrProduct, setIbrProduct] = useState<IbrProduct>(
    initialConfig.analysis === "ibr" ? initialConfig.options.ibr_analysis : DEFAULT_IBR_OPTIONS.ibr_analysis,
  );
  const [texts, setTexts] = useState<Texts>(() => textsFromConfig(initialConfig));
  const [label, setLabel] = useState(sourceRunId ? "Duplicate of " + sourceRunId : "");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunDetail | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetDescription, setPresetDescription] = useState("");
  const [presetShared, setPresetShared] = useState(false);
  const [copied, setCopied] = useState<"json" | "cli" | null>(null);

  const caseId = caseByAnalysis[analysis];
  const descriptor = findCase(caseId);

  const config: AnalysisConfig = useMemo(() => {
    if (analysis === "pf") {
      return {
        analysis: "pf",
        case: caseId,
        options: {
          pf_method: pfMethod,
          tolerance: parse(texts.pf.tolerance),
          max_iter: parse(texts.pf.max_iter),
          enforce_q_limits: enforceQLimits,
          acceleration: parse(texts.pf.acceleration),
          q_limit_tolerance: parse(texts.pf.q_limit_tolerance),
          max_q_limit_switches: parse(texts.pf.max_q_limit_switches),
        },
      };
    }
    if (analysis === "sssa") {
      return { analysis: "sssa", case: caseId, options: { model } };
    }
    if (analysis === "ts") {
      return {
        analysis: "ts",
        case: caseId,
        options: {
          model,
          integrator,
          t_end: parse(texts.ts.t_end),
          dt: parse(texts.ts.dt),
          fault_bus: texts.ts.fault_bus.trim() === "" ? null : parse(texts.ts.fault_bus),
          t_fault: parse(texts.ts.t_fault),
          t_clear: parse(texts.ts.t_clear),
        },
      };
    }
    return {
      analysis: "ibr",
      case: caseId,
      options: {
        ibr_analysis: ibrProduct,
        t_end: parse(texts.ibr.t_end),
        dt: parse(texts.ibr.dt),
        fault_on: parse(texts.ibr.fault_on),
        fault_clear: parse(texts.ibr.fault_clear),
        fault_reactance: parse(texts.ibr.fault_reactance),
        step_on: parse(texts.ibr.step_on),
        step_dv: parse(texts.ibr.step_dv),
        step_dphase_deg: parse(texts.ibr.step_dphase_deg),
        sssa_load_percentages: texts.ibr.sweep
          .split(/[,\s]+/)
          .filter(Boolean)
          .map(Number),
      },
    };
  }, [analysis, caseId, enforceQLimits, ibrProduct, integrator, model, pfMethod, texts]);

  const validation = useMemo(() => validateConfig(config), [config]);
  const errors = validation.ok ? {} : validation.errors;
  const errorEntries = Object.entries(errors);
  const steps = estimatedSteps(config);

  const setPfText = (key: keyof Texts["pf"], value: string) =>
    setTexts((current) => ({ ...current, pf: { ...current.pf, [key]: value } }));
  const setTsText = (key: keyof Texts["ts"], value: string) =>
    setTexts((current) => ({ ...current, ts: { ...current.ts, [key]: value } }));
  const setIbrText = (key: keyof Texts["ibr"], value: string) =>
    setTexts((current) => ({ ...current, ibr: { ...current.ibr, [key]: value } }));

  const changeAnalysis = (next: AnalysisKind) => {
    setAnalysis(next);
    const nextCase = caseByAnalysis[next];
    setModel(defaultModelFor(next, nextCase));
    if (next === "ibr") {
      const allowed = ibrProductsFor(nextCase);
      if (!allowed.includes(ibrProduct)) setIbrProduct(allowed[0] ?? "full");
    }
  };

  const changeCase = (nextCase: string) => {
    setCaseByAnalysis((current) => ({ ...current, [analysis]: nextCase }));
    if (analysis === "sssa" || analysis === "ts") setModel(defaultModelFor(analysis, nextCase));
    if (analysis === "pf") {
      const allowed = pfMethodsFor(nextCase);
      if (!allowed.includes(pfMethod)) setPfMethod(allowed[0] ?? "newton_raphson");
    }
    if (analysis === "ibr") {
      const allowed = ibrProductsFor(nextCase);
      if (!allowed.includes(ibrProduct)) setIbrProduct(allowed[0] ?? "full");
      const switching = nextCase.endsWith("_switch");
      setIbrText("t_end", switching ? "6" : "0.05");
      setIbrText("dt", switching ? "0.002" : "0.001");
    }
  };

  const changePfMethod = (next: PfMethod) => {
    setPfMethod(next);
    // Iteration budgets differ per solver family, mirroring the Python defaults.
    setPfText("max_iter", String(PF_MAX_ITER_DEFAULTS[next]));
  };

  const payload = useMemo(
    () => ({ config, ...(label.trim() ? { label: label.trim() } : {}) }),
    [config, label],
  );
  const payloadJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const cliCommand = useMemo(() => toCliCommand(config), [config]);

  const submit = async () => {
    if (!validation.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        setSubmitError(body.message ?? `Submission failed (${response.status}).`);
        return;
      }
      const run = (await response.json()) as RunDetail;
      setLastRun(run);
      router.push(`/runs/${run.id}`);
    } catch {
      setSubmitError("Cannot reach the solver service. The run was not queued.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!lastRun) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/runs/${lastRun.id}/cancel`, { method: "POST" });
      if (response.ok) setLastRun((await response.json()) as RunDetail);
    } finally {
      setCancelling(false);
    }
  };

  const savePreset = async () => {
    const response = await fetch("/api/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: presetName, description: presetDescription, shared: presetShared, config }),
    });
    if (response.ok) {
      setPresetOpen(false);
      setPresetName("");
      setPresetDescription("");
      router.refresh();
    }
  };

  const applyPreset = (preset: Preset) => {
    const next = preset.config;
    setAnalysis(next.analysis);
    setCaseByAnalysis((current) => ({ ...current, [next.analysis]: next.case }));
    setTexts(textsFromConfig(next));
    if (next.analysis === "pf") {
      setPfMethod(next.options.pf_method);
      setEnforceQLimits(next.options.enforce_q_limits);
    }
    if (next.analysis === "sssa" || next.analysis === "ts") setModel(next.options.model);
    if (next.analysis === "ts") setIntegrator(next.options.integrator);
    if (next.analysis === "ibr") setIbrProduct(next.options.ibr_analysis);
    setLabel(preset.name);
  };

  const reset = () => {
    setTexts(defaultTexts());
    setPfMethod(DEFAULT_PF_OPTIONS.pf_method);
    setEnforceQLimits(DEFAULT_PF_OPTIONS.enforce_q_limits);
    setModel(defaultModelFor(analysis, caseId));
    setIntegrator(DEFAULT_TS_OPTIONS.integrator);
    setIbrProduct(ibrProductsFor(caseId)[0] ?? DEFAULT_IBR_OPTIONS.ibr_analysis);
    setLabel("");
    setSubmitError(null);
    setLastRun(null);
  };

  const duplicate = () => {
    setLabel((current) => (current ? `${current} (copy)` : `${descriptor?.name ?? caseId} (copy)`));
    setLastRun(null);
  };

  const copy = async (kind: "json" | "cli") => {
    try {
      await navigator.clipboard.writeText(kind === "json" ? payloadJson : cliCommand);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const timeDomainIbr = ibrProduct === "ts" || ibrProduct === "full";
  const smibIbr = !caseId.endsWith("_switch");

  return (
    <div className="space-y-2 p-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">New analysis</h1>
          <p className="text-[12.5px] text-fg-muted">
            Configure the study on the left; the workspace mirrors the exact payload that will be dispatched to the solver
            service.
          </p>
        </div>
        <span className="num text-[11.5px] text-fg-subtle">
          {ANALYSIS_LABELS[analysis]} · {caseId}
          {steps !== null ? ` · ${steps.toLocaleString()} steps` : ""}
        </span>
      </header>

      <div className="grid min-h-full grid-cols-1 gap-2 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
      {/* ------------------------------------------------ configuration panel */}
      <div className="space-y-2">
        <Panel>
          <PanelHeader title="Analysis" subtitle={ANALYSIS_DESCRIPTIONS[analysis]} />
          <div className="space-y-3 p-3">
            <div role="radiogroup" aria-label="Analysis type" className="grid grid-cols-2 gap-1.5">
              {ANALYSIS_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={analysis === kind}
                  onClick={() => changeAnalysis(kind)}
                  className={cn(
                    "rounded border px-2 py-1.5 text-left text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-focus",
                    analysis === kind
                      ? "border-primary bg-primary-soft text-fg"
                      : "border-line bg-surface-2 text-fg-muted hover:border-line-strong hover:text-fg",
                  )}
                >
                  <span className="block font-medium">{ANALYSIS_LABELS[kind]}</span>
                  <span className="num block text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">{kind}</span>
                </button>
              ))}
            </div>

            <Field label="Network case" htmlFor="case" error={errors["case"]} required>
              <Select
                id="case"
                value={caseId}
                onValueChange={changeCase}
                invalid={Boolean(errors["case"])}
                options={casesForAnalysis(analysis).map((item) => ({
                  value: item.id,
                  label: `${item.name} — ${item.buses} bus${item.ibrDevices > 0 ? `, ${item.ibrDevices} IBR` : ""}`,
                }))}
              />
            </Field>

            <Field label="Run label" htmlFor="label" hint="Optional; shown in run history and comparisons.">
              <TextInput
                id="label"
                value={label}
                maxLength={120}
                placeholder={descriptor?.name ?? caseId}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Solver parameters" />
          <div className="space-y-3 p-3">
            {analysis === "pf" ? (
              <>
                <Field label="Method" htmlFor="pf-method" error={errors["options.pf_method"]}>
                  <Select
                    id="pf-method"
                    value={pfMethod}
                    onValueChange={changePfMethod}
                    invalid={Boolean(errors["options.pf_method"])}
                    options={pfMethodsFor(caseId).map((method) => ({
                      value: method,
                      label: PF_METHOD_LABELS[method],
                    }))}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Tolerance" htmlFor="tolerance" unit="pu" error={errors["options.tolerance"]}>
                    <NumberInput
                      id="tolerance"
                      value={texts.pf.tolerance}
                      onValueChange={(value) => setPfText("tolerance", value)}
                      invalid={Boolean(errors["options.tolerance"])}
                    />
                  </Field>
                  <Field label="Max iterations" htmlFor="max-iter" error={errors["options.max_iter"]}>
                    <NumberInput
                      id="max-iter"
                      value={texts.pf.max_iter}
                      onValueChange={(value) => setPfText("max_iter", value)}
                      invalid={Boolean(errors["options.max_iter"])}
                    />
                  </Field>
                </div>
                {/* Acceleration only affects the Gauss-Seidel route. */}
                {pfMethod === "gauss_seidel" ? (
                  <Field
                    label="Acceleration factor"
                    htmlFor="acceleration"
                    hint="Gauss-Seidel over-relaxation; 1.4 is the audited default."
                    error={errors["options.acceleration"]}
                  >
                    <NumberInput
                      id="acceleration"
                      value={texts.pf.acceleration}
                      onValueChange={(value) => setPfText("acceleration", value)}
                      invalid={Boolean(errors["options.acceleration"])}
                    />
                  </Field>
                ) : null}
                <Checkbox
                  checked={enforceQLimits}
                  onCheckedChange={setEnforceQLimits}
                  label="Enforce PV reactive limits"
                  description="Switches PV buses to PQ when a generator reactive limit binds."
                />
              </>
            ) : null}

            {analysis === "sssa" || analysis === "ts" ? (
              <Field
                label="Dynamic model"
                htmlFor="model"
                hint={
                  descriptor?.defaultModel
                    ? `${MODEL_LABELS[descriptor.defaultModel]} is the audited default route for this case.`
                    : "This case exposes the classical multimachine route only."
                }
                error={errors["options.model"]}
              >
                <Select
                  id="model"
                  value={model}
                  onValueChange={setModel}
                  invalid={Boolean(errors["options.model"])}
                  options={modelsFor(caseId).map((item) => ({ value: item, label: MODEL_LABELS[item] }))}
                />
              </Field>
            ) : null}

            {analysis === "ts" ? (
              <>
                <Field label="Integrator" htmlFor="integrator" error={errors["options.integrator"]}>
                  <Select
                    id="integrator"
                    value={integrator}
                    onValueChange={setIntegrator}
                    options={(Object.keys(INTEGRATOR_LABELS) as Integrator[]).map((item) => ({
                      value: item,
                      label: INTEGRATOR_LABELS[item],
                    }))}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="End time" htmlFor="t-end" unit="s" error={errors["options.t_end"]}>
                    <NumberInput
                      id="t-end"
                      value={texts.ts.t_end}
                      onValueChange={(value) => setTsText("t_end", value)}
                      invalid={Boolean(errors["options.t_end"])}
                    />
                  </Field>
                  <Field label="Time step" htmlFor="dt" unit="s" error={errors["options.dt"]}>
                    <NumberInput
                      id="dt"
                      value={texts.ts.dt}
                      onValueChange={(value) => setTsText("dt", value)}
                      invalid={Boolean(errors["options.dt"])}
                    />
                  </Field>
                </div>
                <Field
                  label="Fault bus"
                  htmlFor="fault-bus"
                  hint="Leave empty for an undisturbed simulation; fault settings appear when set."
                  error={errors["options.fault_bus"]}
                >
                  <NumberInput
                    id="fault-bus"
                    value={texts.ts.fault_bus}
                    placeholder="none"
                    onValueChange={(value) => setTsText("fault_bus", value)}
                    invalid={Boolean(errors["options.fault_bus"])}
                  />
                </Field>
                {/* Event timing is irrelevant without a fault bus, so it disappears. */}
                {texts.ts.fault_bus.trim() !== "" ? (
                  <div className="grid grid-cols-2 gap-2 rounded border border-line bg-surface-2/40 p-2">
                    <Field label="Fault applied" htmlFor="t-fault" unit="s" error={errors["options.t_fault"]}>
                      <NumberInput
                        id="t-fault"
                        value={texts.ts.t_fault}
                        onValueChange={(value) => setTsText("t_fault", value)}
                        invalid={Boolean(errors["options.t_fault"])}
                      />
                    </Field>
                    <Field label="Fault cleared" htmlFor="t-clear" unit="s" error={errors["options.t_clear"]}>
                      <NumberInput
                        id="t-clear"
                        value={texts.ts.t_clear}
                        onValueChange={(value) => setTsText("t_clear", value)}
                        invalid={Boolean(errors["options.t_clear"])}
                      />
                    </Field>
                  </div>
                ) : null}
              </>
            ) : null}

            {analysis === "ibr" ? (
              <>
                <Field label="IBR product" htmlFor="ibr-product" error={errors["options.ibr_analysis"]}>
                  <Select
                    id="ibr-product"
                    value={ibrProduct}
                    onValueChange={setIbrProduct}
                    options={ibrProductsFor(caseId).map((item) => ({
                      value: item,
                      label: IBR_PRODUCT_LABELS[item],
                    }))}
                  />
                </Field>
                {/* Integration window only matters for time-domain products. */}
                {timeDomainIbr ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="End time" htmlFor="ibr-t-end" unit="s" error={errors["options.t_end"]}>
                      <NumberInput
                        id="ibr-t-end"
                        value={texts.ibr.t_end}
                        onValueChange={(value) => setIbrText("t_end", value)}
                        invalid={Boolean(errors["options.t_end"])}
                      />
                    </Field>
                    <Field label="Time step" htmlFor="ibr-dt" unit="s" error={errors["options.dt"]}>
                      <NumberInput
                        id="ibr-dt"
                        value={texts.ibr.dt}
                        onValueChange={(value) => setIbrText("dt", value)}
                        invalid={Boolean(errors["options.dt"])}
                      />
                    </Field>
                  </div>
                ) : null}
                {ibrProduct === "sssa_load_sweep" ? (
                  <Field
                    label="Load percentages"
                    htmlFor="sweep"
                    unit="%"
                    hint="Comma separated sweep points, e.g. 0, 20, 40, 60, 80."
                    error={errors["options.sssa_load_percentages"]}
                  >
                    <TextInput
                      id="sweep"
                      mono
                      value={texts.ibr.sweep}
                      onChange={(event) => setIbrText("sweep", event.target.value)}
                      invalid={Boolean(errors["options.sssa_load_percentages"])}
                    />
                  </Field>
                ) : null}
                {timeDomainIbr && smibIbr ? (
                  <div className="space-y-2 rounded border border-line bg-surface-2/40 p-2">
                    <p className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-fg-subtle">
                      PCC shunt fault
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="On" htmlFor="fault-on" unit="s" error={errors["options.fault_on"]}>
                        <NumberInput
                          id="fault-on"
                          value={texts.ibr.fault_on}
                          onValueChange={(value) => setIbrText("fault_on", value)}
                          invalid={Boolean(errors["options.fault_on"])}
                        />
                      </Field>
                      <Field label="Clear" htmlFor="fault-clear" unit="s" error={errors["options.fault_clear"]}>
                        <NumberInput
                          id="fault-clear"
                          value={texts.ibr.fault_clear}
                          onValueChange={(value) => setIbrText("fault_clear", value)}
                          invalid={Boolean(errors["options.fault_clear"])}
                        />
                      </Field>
                      <Field label="X_f" htmlFor="fault-x" unit="pu" error={errors["options.fault_reactance"]}>
                        <NumberInput
                          id="fault-x"
                          value={texts.ibr.fault_reactance}
                          onValueChange={(value) => setIbrText("fault_reactance", value)}
                          invalid={Boolean(errors["options.fault_reactance"])}
                        />
                      </Field>
                    </div>
                  </div>
                ) : null}
                {caseId.endsWith("_switch") ? (
                  <p className="rounded border border-info/40 bg-info-soft px-2 py-1.5 text-[11.5px] text-fg-muted">
                    AGSI++ switching cases generate their own trip/reclose and GFL↔GFM event schedule; per-event fault
                    parameters are not exposed.
                  </p>
                ) : null}
              </>
            ) : null}

            {/* Advanced parameters stay collapsed so the default view is calm. */}
            {analysis === "pf" || (analysis === "ibr" && timeDomainIbr && smibIbr) ? (
              <div className="rounded border border-line">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  aria-expanded={advancedOpen}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-[12px] text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span>Advanced parameters</span>
                  <span className="num text-[11px] text-fg-subtle">{advancedOpen ? "hide" : "show"}</span>
                </button>
                {advancedOpen ? (
                  <div className="space-y-2 border-t border-line p-2">
                    {analysis === "pf" ? (
                      <>
                        <Field
                          label="Q-limit tolerance"
                          htmlFor="qlim-tol"
                          unit="pu"
                          error={errors["options.q_limit_tolerance"]}
                        >
                          <NumberInput
                            id="qlim-tol"
                            value={texts.pf.q_limit_tolerance}
                            onValueChange={(value) => setPfText("q_limit_tolerance", value)}
                            invalid={Boolean(errors["options.q_limit_tolerance"])}
                          />
                        </Field>
                        <Field
                          label="Max Q-limit switches"
                          htmlFor="qlim-max"
                          error={errors["options.max_q_limit_switches"]}
                        >
                          <NumberInput
                            id="qlim-max"
                            value={texts.pf.max_q_limit_switches}
                            onValueChange={(value) => setPfText("max_q_limit_switches", value)}
                            invalid={Boolean(errors["options.max_q_limit_switches"])}
                          />
                        </Field>
                      </>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <Field label="Step on" htmlFor="step-on" unit="s" error={errors["options.step_on"]}>
                          <NumberInput
                            id="step-on"
                            value={texts.ibr.step_on}
                            onValueChange={(value) => setIbrText("step_on", value)}
                            invalid={Boolean(errors["options.step_on"])}
                          />
                        </Field>
                        <Field label="ΔV" htmlFor="step-dv" unit="pu" error={errors["options.step_dv"]}>
                          <NumberInput
                            id="step-dv"
                            value={texts.ibr.step_dv}
                            onValueChange={(value) => setIbrText("step_dv", value)}
                            invalid={Boolean(errors["options.step_dv"])}
                          />
                        </Field>
                        <Field label="Δφ" htmlFor="step-dphase" unit="deg" error={errors["options.step_dphase_deg"]}>
                          <NumberInput
                            id="step-dphase"
                            value={texts.ibr.step_dphase_deg}
                            onValueChange={(value) => setIbrText("step_dphase_deg", value)}
                            invalid={Boolean(errors["options.step_dphase_deg"])}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface-2/40 p-2">
            <Button
              variant="primary"
              onClick={() => void submit()}
              loading={submitting}
              disabled={!validation.ok || !canSubmit}
              title={canSubmit ? undefined : "Your role cannot submit runs"}
            >
              <Play aria-hidden className="size-3.5" />
              Run analysis
            </Button>
            <Button
              variant="secondary"
              onClick={() => void cancel()}
              loading={cancelling}
              disabled={!lastRun || lastRun.status === "cancelled"}
            >
              <Square aria-hidden className="size-3.5" />
              Cancel
            </Button>
            <Button variant="ghost" onClick={duplicate}>
              <Copy aria-hidden className="size-3.5" />
              Duplicate
            </Button>
            <Button variant="ghost" onClick={() => setPresetOpen(true)} disabled={!validation.ok || !canSubmit}>
              <Save aria-hidden className="size-3.5" />
              Save preset
            </Button>
            <Button variant="ghost" onClick={reset}>
              <RotateCcw aria-hidden className="size-3.5" />
              Reset
            </Button>
          </footer>
        </Panel>

        {presets.length > 0 ? (
          <Panel>
            <PanelHeader title="Presets" subtitle="Apply a stored configuration" />
            <ul className="divide-y divide-line">
              {presets.map((preset) => (
                <li key={preset.id}>
                  <button
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{preset.name}</span>
                      <Badge tone="primary">{preset.config.analysis}</Badge>
                      {preset.shared ? <Badge>shared</Badge> : null}
                    </span>
                    <span className="truncate text-[11.5px] text-fg-subtle">{preset.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      {/* ----------------------------------------------------- result surface */}
      <div className="space-y-2">
        {submitError ? <ErrorState title="Submission rejected" message={submitError} /> : null}

        {lastRun ? (
          <Panel className="border-primary/50">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <Badge tone="primary">{lastRun.status}</Badge>
              <span className="num text-[12.5px] text-fg">{lastRun.id}</span>
              <span className="text-[12.5px] text-fg-muted">{lastRun.label}</span>
              <Button variant="secondary" size="sm" className="ml-auto" onClick={() => router.push(`/runs/${lastRun.id}`)}>
                Open live monitor
              </Button>
            </div>
          </Panel>
        ) : null}

        <div className="grid gap-2 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Case snapshot" />
            <div className="p-3">
              <KeyValue
                columns={1}
                items={[
                  { label: "Case id", value: descriptor?.id ?? caseId },
                  { label: "System", value: descriptor?.name ?? "—", mono: false },
                  { label: "Buses", value: descriptor?.buses ?? "—" },
                  { label: "Branches", value: descriptor?.branches ?? "—" },
                  { label: "Synchronous machines", value: descriptor?.generators ?? "—" },
                  { label: "IBR devices", value: descriptor?.ibrDevices ?? 0 },
                  { label: "Radial", value: descriptor?.radial ? "yes" : "no" },
                  { label: "Readiness", value: descriptor?.readiness ?? "—", mono: false },
                  { label: "Provenance", value: descriptor?.provenance ?? "—", mono: false },
                ]}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Pre-flight validation"
              actions={
                validation.ok ? (
                  <Badge tone="ok">
                    <Check aria-hidden className="size-3" />
                    ready
                  </Badge>
                ) : (
                  <Badge tone="danger">
                    <AlertTriangle aria-hidden className="size-3" />
                    {errorEntries.length} issue{errorEntries.length === 1 ? "" : "s"}
                  </Badge>
                )
              }
            />
            <div className="space-y-2 p-3">
              {errorEntries.length === 0 ? (
                <p className="text-[12.5px] text-fg-muted">
                  All numerical ranges are inside the solver&apos;s accepted domain. The configuration below is what will be
                  posted to the job service.
                </p>
              ) : (
                <ul className="space-y-1">
                  {errorEntries.map(([path, message]) => (
                    <li key={path} className="flex items-start gap-2 text-[12.5px]">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-danger" />
                      <span>
                        <span className="num text-fg-subtle">{path}</span> — <span className="text-fg-muted">{message}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <KeyValue
                columns={1}
                items={[
                  { label: "Analysis", value: ANALYSIS_LABELS[analysis], mono: false },
                  ...(steps !== null ? [{ label: "Integration steps", value: steps.toLocaleString() }] : []),
                  ...(analysis === "pf" ? [{ label: "Iteration budget", value: texts.pf.max_iter }] : []),
                  { label: "Expected telemetry", value: expectedTelemetry(analysis), mono: false },
                ]}
              />
            </div>
          </Panel>
        </div>

        <Panel>
          <PanelHeader
            title="Reproducible configuration"
            icon={<FileJson className="size-3.5" />}
            actions={
              <>
                <Button variant="ghost" size="sm" onClick={() => void copy("json")}>
                  {copied === "json" ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
                  Copy JSON
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadBlob(`run-config-${caseId}.json`, "application/json", payloadJson)}
                >
                  <Download aria-hidden className="size-3.5" />
                  Download
                </Button>
              </>
            }
          />
          <pre className="max-h-[26rem] overflow-auto bg-surface-inset p-3 text-[12px] leading-[1.5] text-fg">
            <code className="num">{payloadJson}</code>
          </pre>
          <div className="flex items-center gap-2 border-t border-line bg-surface-2/40 px-3 py-2">
            <Terminal aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
            <code className="num min-w-0 flex-1 truncate text-[11.5px] text-fg-muted">{cliCommand}</code>
            <Button variant="ghost" size="sm" onClick={() => void copy("cli")}>
              {copied === "cli" ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
              Copy CLI
            </Button>
          </div>
        </Panel>
      </div>

      </div>

      <Dialog
        open={presetOpen}
        onOpenChange={setPresetOpen}
        title="Save configuration preset"
        description="Presets store the exact option set, including advanced parameters."
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPresetOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={presetName.trim().length === 0} onClick={() => void savePreset()}>
              Save preset
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Preset name" htmlFor="preset-name" required>
            <TextInput
              id="preset-name"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              placeholder="IEEE14 tight NR"
            />
          </Field>
          <Field label="Description" htmlFor="preset-description">
            <TextInput
              id="preset-description"
              value={presetDescription}
              onChange={(event) => setPresetDescription(event.target.value)}
              placeholder="Newton-Raphson, 1e-10, Q-limits enforced"
            />
          </Field>
          <Checkbox
            checked={presetShared}
            onCheckedChange={setPresetShared}
            label="Share with the study team"
            description="Shared presets appear for every signed-in user."
          />
        </div>
      </Dialog>
    </div>
  );
}

function expectedTelemetry(analysis: AnalysisKind): string {
  if (analysis === "pf") return "mismatch history, voltage band, angle spread";
  if (analysis === "sssa") return "equilibrium residual, damping, eigenvalues";
  if (analysis === "ts") return "rotor angle, frequency, voltage, P/Q, residual";
  return "PCC voltage, frequency, P/Q, AGSI++, control mode";
}
