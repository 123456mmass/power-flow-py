"use client";

import { useEffect, useRef, useState } from "react";

import type {
  LogRecord,
  RunDetail,
  RunProgress,
  RunStatus,
  SeriesChunk,
  SimEvent,
} from "@/lib/domain/types";
import { isTerminal } from "@/lib/domain/types";
import { createRunStream, type ConnectionState } from "@/lib/solver/stream";

const MAX_LOGS = 4000;

export interface UseRunStreamOptions {
  runId: string;
  initial: RunDetail;
  /** Sample batches are handed straight to the charts, never to React state. */
  onChunk: (chunk: SeriesChunk, mode: "snapshot" | "live") => void;
  baseUrl?: string;
}

export interface RunStreamState {
  detail: RunDetail;
  progress: RunProgress;
  status: RunStatus;
  logs: LogRecord[];
  events: SimEvent[];
  connection: ConnectionState;
  streamError: string | null;
  /** Increments whenever a new sample batch has been dispatched. */
  sampleTick: number;
  /** Latest value per signal, kept small for live indicators/animations. */
  latestSample: { t: number | null; values: Record<string, number> };
  reconnectCount: number;
}

export function useRunStream({ runId, initial, onChunk, baseUrl }: UseRunStreamOptions): RunStreamState {
  const [detail, setDetail] = useState<RunDetail>(initial);
  const [progress, setProgress] = useState<RunProgress>(initial.progress);
  const [status, setStatus] = useState<RunStatus>(initial.status);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [events, setEvents] = useState<SimEvent[]>(initial.events);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [sampleTick, setSampleTick] = useState(0);
  const [latestSample, setLatestSample] = useState<{ t: number | null; values: Record<string, number> }>({
    t: null,
    values: {},
  });
  const [reconnectCount, setReconnectCount] = useState(0);
  const chunkRef = useRef(onChunk);
  const seenSnapshot = useRef(false);

  chunkRef.current = onChunk;

  const rememberLatest = (chunk: SeriesChunk) => {
    const index = chunk.t.length - 1;
    if (index < 0) return;
    setLatestSample((current) => {
      const values = { ...current.values };
      for (const [signalId, samples] of Object.entries(chunk.values)) {
        const value = samples[index];
        if (value !== undefined && Number.isFinite(value)) values[signalId] = value;
      }
      return { t: chunk.t[index] ?? current.t, values };
    });
  };

  useEffect(() => {
    const base = baseUrl ?? process.env.NEXT_PUBLIC_SOLVER_API_BASE ?? "/api";
    const handle = createRunStream(`${base}/runs/${encodeURIComponent(runId)}/stream`, {
      onConnectionChange: (state) => {
        setConnection(state);
        if (state === "reconnecting") setReconnectCount((count) => count + 1);
      },
      onEvent: (event) => {
        switch (event.type) {
          case "snapshot": {
            const mode = seenSnapshot.current ? "live" : "snapshot";
            seenSnapshot.current = true;
            setDetail(event.run);
            setProgress(event.run.progress);
            setStatus(event.run.status);
            setEvents(event.run.events);
            if (event.logs.length > 0) {
              setLogs((current) => [...current, ...event.logs].slice(-MAX_LOGS));
            }
            for (const chunk of event.chunks) {
              chunkRef.current(chunk, mode);
              rememberLatest(chunk);
            }
            if (event.chunks.length > 0) setSampleTick((tick) => tick + 1);
            break;
          }
          case "status":
            setStatus(event.status);
            setDetail((current) => ({ ...current, status: event.status }));
            break;
          case "progress":
            setProgress(event.progress);
            break;
          case "log":
            setLogs((current) => [...current, ...event.records].slice(-MAX_LOGS));
            break;
          case "samples":
            chunkRef.current(event.chunk, "live");
            rememberLatest(event.chunk);
            setSampleTick((tick) => tick + 1);
            break;
          case "event":
            setEvents((current) => (current.some((item) => item.id === event.event.id) ? current : [...current, event.event]));
            break;
          case "done":
            setStatus(event.status);
            setDetail((current) => ({ ...current, status: event.status }));
            break;
          case "error":
            setStreamError(event.message);
            break;
        }
      },
    });

    return () => handle.close();
  }, [baseUrl, runId]);

  // Refresh the authoritative record once the run reaches a terminal state so
  // duration, reason and warning counts are exact.
  useEffect(() => {
    if (!isTerminal(status)) return;
    let active = true;
    void (async () => {
      try {
        const base = baseUrl ?? process.env.NEXT_PUBLIC_SOLVER_API_BASE ?? "/api";
        const response = await fetch(`${base}/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const fresh = (await response.json()) as RunDetail;
        if (!active) return;
        setDetail(fresh);
        setProgress(fresh.progress);
      } catch {
        /* keep the streamed view */
      }
    })();
    return () => {
      active = false;
    };
  }, [baseUrl, runId, status]);

  return {
    detail,
    progress,
    status,
    logs,
    events,
    connection,
    streamError,
    sampleTick,
    latestSample,
    reconnectCount,
  };
}
