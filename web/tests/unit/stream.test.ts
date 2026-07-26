import { describe, expect, it, vi } from "vitest";

import type { RunStreamEvent, SeriesChunk } from "@/lib/domain/types";
import { backoffDelay, createRunStream, type EventSourceLike } from "@/lib/solver/stream";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: "message" | "open" | "error", listener: (event: unknown) => void): void {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    for (const listener of this.listeners.get("open") ?? []) listener({});
  }

  emit(event: RunStreamEvent): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: JSON.stringify(event) });
  }

  emitRaw(data: string): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  emitError(): void {
    for (const listener of this.listeners.get("error") ?? []) listener({});
  }
}

function chunk(seq: number, t: number[]): SeriesChunk {
  return { seq, t, values: { v: t.map(() => 1) } };
}

function harness(options: { maxAttempts?: number } = {}) {
  FakeEventSource.instances = [];
  const events: RunStreamEvent[] = [];
  const states: string[] = [];
  const scheduled: (() => void)[] = [];
  const handle = createRunStream(
    "/api/runs/run-0001/stream",
    {
      onEvent: (event) => events.push(event),
      onConnectionChange: (state) => states.push(state),
    },
    {
      factory: (url) => new FakeEventSource(url),
      scheduler: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelScheduled: () => undefined,
      baseDelayMs: 10,
      maxDelayMs: 100,
      ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    },
  );
  return { events, states, scheduled, handle };
}

describe("run stream controller", () => {
  it("connects with fromSeq=0 and reports the open state", () => {
    const { states } = harness();
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toContain("fromSeq=0");
    source.emitOpen();
    expect(states).toEqual(["connecting", "open"]);
  });

  it("forwards parsed events and ignores malformed payloads", () => {
    const { events } = harness();
    const source = FakeEventSource.instances[0]!;
    source.emitRaw("not-json");
    source.emit({ type: "samples", runId: "run-0001", chunk: chunk(3, [0.1, 0.2]) });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "samples" });
  });

  it("resumes from the last received sequence after a dropped connection", () => {
    const { states, scheduled } = harness();
    const first = FakeEventSource.instances[0]!;
    first.emitOpen();
    first.emit({ type: "samples", runId: "run-0001", chunk: chunk(7, [0.1]) });
    first.emit({
      type: "log",
      runId: "run-0001",
      records: [{ seq: 9, at: new Date().toISOString(), level: "info", source: "solver", message: "iter 1" }],
    });

    first.emitError();
    expect(first.closed).toBe(true);
    expect(states).toContain("reconnecting");

    // Run the scheduled backoff callback.
    scheduled[0]!();
    const second = FakeEventSource.instances[1]!;
    expect(second.url).toContain("fromSeq=9");
  });

  it("uses exponential backoff capped at the maximum delay", () => {
    expect(backoffDelay(1, 700, 8000)).toBe(700);
    expect(backoffDelay(2, 700, 8000)).toBe(1400);
    expect(backoffDelay(3, 700, 8000)).toBe(2800);
    expect(backoffDelay(9, 700, 8000)).toBe(8000);
  });

  it("gives up after the attempt budget and surfaces a stream error", () => {
    const { events, scheduled } = harness({ maxAttempts: 2 });
    FakeEventSource.instances[0]!.emitError();
    scheduled[0]!();
    FakeEventSource.instances[1]!.emitError();
    scheduled[1]!();
    FakeEventSource.instances[2]!.emitError();

    const error = events.find((event) => event.type === "error");
    expect(error).toBeDefined();
    if (error?.type === "error") expect(error.code).toBe("stream_unavailable");
  });

  it("closes the source when the run finishes", () => {
    const { states } = harness();
    const source = FakeEventSource.instances[0]!;
    source.emitOpen();
    source.emit({ type: "done", runId: "run-0001", status: "converged" });
    expect(source.closed).toBe(true);
    expect(states.at(-1)).toBe("closed");
  });

  it("stops reconnecting once closed by the caller", () => {
    const cancel = vi.fn();
    FakeEventSource.instances = [];
    const handle = createRunStream(
      "/api/runs/run-0001/stream",
      { onEvent: () => undefined },
      {
        factory: (url) => new FakeEventSource(url),
        scheduler: () => 1,
        cancelScheduled: cancel,
      },
    );
    handle.close();
    const source = FakeEventSource.instances[0]!;
    expect(source.closed).toBe(true);
    source.emitError();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
