"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/feedback";
import { Checkbox, Field, NumberInput } from "@/components/ui/inputs";
import { KeyValue, Panel, PanelHeader } from "@/components/ui/panel";
import type { HealthReport } from "@/lib/domain/types";
import { formatDuration, formatTimestamp } from "@/lib/utils/format";

const PREFS_KEY = "pfw-stream-prefs";

interface StreamPrefs {
  followNewest: boolean;
  windowSeconds: number;
  autoReconnect: boolean;
}

const DEFAULT_PREFS: StreamPrefs = { followNewest: true, windowSeconds: 0, autoReconnect: true };

export function SettingsPanels({
  user,
  adapterId,
  apiBase,
  health,
}: {
  user: { name: string; email: string; role: string };
  adapterId: string;
  apiBase: string;
  health: HealthReport;
}) {
  const [prefs, setPrefs] = useState<StreamPrefs>(DEFAULT_PREFS);
  const [windowText, setWindowText] = useState("0");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PREFS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StreamPrefs;
        setPrefs({ ...DEFAULT_PREFS, ...parsed });
        setWindowText(String(parsed.windowSeconds ?? 0));
      }
    } catch {
      /* ignore malformed preferences */
    }
  }, []);

  const persist = (next: StreamPrefs) => {
    setPrefs(next);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  };

  return (
    <div className="space-y-2 p-3">
      <header>
        <h1 className="text-[17px] font-semibold tracking-tight">Settings</h1>
        <p className="text-[12.5px] text-fg-muted">
          Console preferences are stored locally. Solver behaviour is configured per run in the analysis workspace.
        </p>
      </header>

      <div className="grid gap-2 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Session" />
          <div className="p-3">
            <KeyValue
              columns={1}
              items={[
                { label: "Name", value: user.name, mono: false },
                { label: "Email", value: user.email },
                { label: "Role", value: user.role, mono: false },
                { label: "Identity adapter", value: adapterId },
              ]}
            />
            <p className="mt-2 text-[11.5px] text-fg-subtle">
              Roles gate mutations: engineers and admins can submit, cancel and delete; analysts and viewers are
              read-only.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Backend connection"
            actions={<Badge tone={health.status === "ok" ? "ok" : health.status === "degraded" ? "warn" : "danger"}>{health.status}</Badge>}
          />
          <div className="p-3">
            <KeyValue
              columns={1}
              items={[
                { label: "REST/SSE base", value: apiBase },
                { label: "Solver version", value: health.solverVersion },
                { label: "Workers online", value: `${health.workers.filter((worker) => worker.status !== "offline").length}/${health.workers.length}` },
                { label: "Queue depth", value: health.queueDepth },
                { label: "Uptime", value: formatDuration(health.uptimeS * 1000) },
                { label: "Checked", value: formatTimestamp(health.checkedAt) },
              ]}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Streaming preferences" />
          <div className="space-y-3 p-3">
            <Checkbox
              checked={prefs.followNewest}
              onCheckedChange={(checked) => persist({ ...prefs, followNewest: checked })}
              label="Follow newest samples by default"
              description="New charts scroll with incoming data until you zoom."
            />
            <Checkbox
              checked={prefs.autoReconnect}
              onCheckedChange={(checked) => persist({ ...prefs, autoReconnect: checked })}
              label="Reconnect dropped streams automatically"
              description="Resumes from the last received sample sequence with exponential backoff."
            />
            <Field
              label="Sliding window"
              htmlFor="window"
              unit="s"
              hint="0 keeps the full history in view; a positive value shows only the most recent seconds."
            >
              <NumberInput
                id="window"
                value={windowText}
                onValueChange={(value) => {
                  setWindowText(value);
                  const parsed = Number(value);
                  if (Number.isFinite(parsed) && parsed >= 0) persist({ ...prefs, windowSeconds: parsed });
                }}
              />
            </Field>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="About this console" />
          <div className="space-y-2 p-3 text-[12.5px] text-fg-muted">
            <p>
              All numerical work — power flow, small-signal analysis, time-domain integration and IBR switching — runs in
              the Python solver service. This console only submits configurations, renders streamed telemetry and formats
              results.
            </p>
            <p>
              Charts use uPlot for dense streaming traces and Plotly for the eigenvalue plane. Both support zoom, pan,
              crosshair, legend toggling and image export.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
