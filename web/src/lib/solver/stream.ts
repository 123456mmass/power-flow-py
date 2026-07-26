/**
 * Resumable SSE consumer for run streams.
 *
 * The server assigns a monotonic `seq` to every log record and sample chunk.
 * On a dropped connection the controller reconnects with `?fromSeq=<last seq>`
 * so no sample is lost and none is replayed twice. The `EventSource` factory is
 * injectable so the reconnect policy can be unit-tested without a browser.
 */

import type { RunStreamEvent } from "../domain/types";
import type { StreamCallbacks, StreamHandle } from "./client";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface EventSourceLike {
  addEventListener(type: "message" | "open" | "error", listener: (event: unknown) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface RunStreamOptions {
  factory?: EventSourceFactory;
  /** First backoff delay in ms; doubles up to `maxDelayMs`. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  scheduler?: (callback: () => void, delayMs: number) => number;
  cancelScheduled?: (handle: number) => void;
}

const defaultFactory: EventSourceFactory = (url) =>
  new EventSource(url, { withCredentials: true }) as unknown as EventSourceLike;

export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

export function createRunStream(
  url: string,
  callbacks: StreamCallbacks,
  options: RunStreamOptions = {},
): StreamHandle {
  const factory = options.factory ?? defaultFactory;
  const baseDelayMs = options.baseDelayMs ?? 700;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const maxAttempts = options.maxAttempts ?? 8;
  const scheduler =
    options.scheduler ?? ((callback, delay) => setTimeout(callback, delay) as unknown as number);
  const cancelScheduled = options.cancelScheduled ?? ((handle) => clearTimeout(handle));

  let source: EventSourceLike | null = null;
  let timer: number | null = null;
  let attempt = 0;
  let lastSeq = callbacks.fromSeq ?? 0;
  let closed = false;

  const setState = (state: ConnectionState) => callbacks.onConnectionChange?.(state);

  const connect = () => {
    if (closed) return;
    setState(attempt === 0 ? "connecting" : "reconnecting");
    const target = `${url}${url.includes("?") ? "&" : "?"}fromSeq=${lastSeq}`;
    const es = factory(target);
    source = es;

    es.addEventListener("open", () => {
      attempt = 0;
      setState("open");
    });

    es.addEventListener("message", (raw) => {
      const data = (raw as { data?: unknown }).data;
      if (typeof data !== "string" || data.length === 0) return;
      let event: RunStreamEvent;
      try {
        event = JSON.parse(data) as RunStreamEvent;
      } catch {
        return;
      }
      if (event.type === "samples") lastSeq = Math.max(lastSeq, event.chunk.seq);
      if (event.type === "log") {
        for (const record of event.records) lastSeq = Math.max(lastSeq, record.seq);
      }
      if (event.type === "snapshot") {
        for (const chunk of event.chunks) lastSeq = Math.max(lastSeq, chunk.seq);
        for (const record of event.logs) lastSeq = Math.max(lastSeq, record.seq);
      }
      callbacks.onEvent(event);
      if (event.type === "done") {
        closed = true;
        es.close();
        setState("closed");
      }
    });

    es.addEventListener("error", () => {
      if (closed) return;
      es.close();
      source = null;
      attempt += 1;
      if (attempt > maxAttempts) {
        closed = true;
        setState("closed");
        callbacks.onEvent({
          type: "error",
          runId: "",
          code: "stream_unavailable",
          message: `Stream lost after ${maxAttempts} reconnect attempts.`,
        });
        return;
      }
      setState("reconnecting");
      timer = scheduler(connect, backoffDelay(attempt, baseDelayMs, maxDelayMs));
    });
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (timer !== null) cancelScheduled(timer);
      source?.close();
      setState("closed");
    },
  };
}
