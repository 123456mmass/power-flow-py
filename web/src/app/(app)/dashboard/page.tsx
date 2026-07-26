import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, Cpu, Play, XCircle, Zap } from "lucide-react";

import { TrendCharts } from "@/components/dashboard/trend-charts";
import { RunTable } from "@/components/runs/run-table";
import { Badge } from "@/components/ui/feedback";
import { Panel, PanelHeader, StatCard } from "@/components/ui/panel";
import { ANALYSIS_LABELS, DEFAULT_CASE } from "@/lib/domain/catalog";
import type { AnalysisKind } from "@/lib/domain/types";
import { formatDuration, formatPercent, formatRelative } from "@/lib/utils/format";
import { readHealth, readRuns, readStats } from "@/server/data";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const QUICK_ACTIONS: { analysis: AnalysisKind; label: string }[] = [
  { analysis: "pf", label: "New power flow" },
  { analysis: "sssa", label: "New SSSA" },
  { analysis: "ts", label: "New TDS" },
  { analysis: "ibr", label: "New IBR study" },
];

export default async function DashboardPage() {
  const [stats, health, recent] = await Promise.all([readStats(), readHealth(), readRuns({ pageSize: 12 })]);
  const successRate = stats.totalRuns > 0 ? stats.converged / stats.totalRuns : 0;

  return (
    <div className="space-y-3 p-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Study fleet overview</h1>
          <p className="text-[12.5px] text-fg-muted">
            {stats.totalRuns} runs tracked · avg wall time {formatDuration(stats.avgDurationMs)} · solver{" "}
            <span className="num">{health.solverVersion}</span>
          </p>
        </div>
        <nav aria-label="Quick actions" className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.analysis}
              href={`/analysis/new?analysis=${action.analysis}&case=${DEFAULT_CASE[action.analysis]}`}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-line bg-surface-2 px-2.5 text-[12.5px] text-fg hover:border-primary/60 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-focus"
            >
              <Zap aria-hidden className="size-3.5 text-primary" />
              {action.label}
            </Link>
          ))}
        </nav>
      </header>

      <section aria-label="Summary" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Runs tracked"
          value={stats.totalRuns}
          icon={<Activity className="size-4" />}
          hint={`${stats.cancelled} cancelled`}
          footer={<span>Success rate {formatPercent(successRate, 0)}</span>}
        />
        <StatCard
          label="Converged"
          value={stats.converged}
          tone="ok"
          icon={<CheckCircle2 className="size-4" />}
          hint="Tolerance met, finite states"
          footer={<span>Latest {formatRelative(recent.items.find((run) => run.status === "converged")?.finishedAt ?? null)}</span>}
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          tone={stats.failed > 0 ? "danger" : "neutral"}
          icon={<XCircle className="size-4" />}
          hint="Iteration limit or fail-closed guard"
          footer={<span>Inspect reason codes in Runs</span>}
        />
        <StatCard
          label="Running now"
          value={stats.running}
          tone={stats.running > 0 ? "primary" : "neutral"}
          icon={<Play className="size-4" />}
          hint={`${health.queueDepth} queued`}
          footer={
            <span>
              {health.workers.filter((worker) => worker.status === "busy").length} of{" "}
              {health.workers.filter((worker) => worker.status !== "offline").length} workers busy
            </span>
          }
        />
      </section>

      <TrendCharts trend={stats.trend} />

      <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel>
          <PanelHeader
            title="Recent analyses"
            subtitle="Click a row to open the live monitor or the result workspace"
            actions={
              <Link href="/runs" className="text-[12px] text-primary hover:underline">
                View all
              </Link>
            }
          />
          <RunTable runs={recent.items} maxHeight="27rem" csvName="recent-runs" />
        </Panel>

        <div className="space-y-2">
          <Panel>
            <PanelHeader
              title="Solver health"
              icon={<Cpu className="size-3.5" />}
              actions={
                <Badge tone={health.status === "ok" ? "ok" : health.status === "degraded" ? "warn" : "danger"}>
                  {health.status}
                </Badge>
              }
            />
            <ul className="divide-y divide-line">
              {health.workers.map((worker) => (
                <li key={worker.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[12.5px] text-fg">{worker.id}</span>
                    <Badge
                      tone={worker.status === "busy" ? "primary" : worker.status === "idle" ? "ok" : "danger"}
                    >
                      {worker.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px] text-fg-subtle">
                    <div>
                      <div className="flex justify-between">
                        <span>CPU</span>
                        <span className="num">{worker.cpuPct}%</span>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full bg-surface-3">
                        <div
                          className={worker.cpuPct > 85 ? "h-full rounded-full bg-warn" : "h-full rounded-full bg-primary"}
                          style={{ width: `${worker.cpuPct}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between">
                        <span>Memory</span>
                        <span className="num">{worker.memPct}%</span>
                      </div>
                      <div className="mt-0.5 h-1 rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-info" style={{ width: `${worker.memPct}%` }} />
                      </div>
                    </div>
                  </div>
                  {worker.currentRunId ? (
                    <p className="num mt-1 text-[11px] text-fg-subtle">
                      running{" "}
                      <Link href={`/runs/${worker.currentRunId}`} className="text-primary hover:underline">
                        {worker.currentRunId}
                      </Link>
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      last heartbeat {formatRelative(worker.lastHeartbeat)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title="Queue" />
            <dl className="space-y-1.5 px-3 py-2 text-[12.5px]">
              <div className="flex justify-between">
                <dt className="text-fg-muted">Queued jobs</dt>
                <dd className="num">{health.queueDepth}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">Active jobs</dt>
                <dd className="num">{stats.running}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">Service uptime</dt>
                <dd className="num">{formatDuration(health.uptimeS * 1000)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-muted">Analyses enabled</dt>
                <dd className="num text-right">{Object.values(ANALYSIS_LABELS).length}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
