import { describe, expect, it, vi } from "vitest";

import { DEFAULT_IBR_OPTIONS, DEFAULT_PF_OPTIONS } from "@/lib/domain/catalog";
import type { RunStreamEvent } from "@/lib/domain/types";
import { getEngine } from "@/server/mock/engine";

const engine = getEngine();

function pfRequest() {
  return {
    config: { analysis: "pf" as const, case: "ieee14", options: { ...DEFAULT_PF_OPTIONS } },
    label: "integration pf",
  };
}

describe("mock job engine", () => {
  it("seeds a run history covering every analysis family", () => {
    const page = engine.list({ pageSize: 100 });
    expect(page.total).toBeGreaterThan(15);
    const analyses = new Set(page.items.map((item) => item.analysis));
    expect([...analyses].sort()).toEqual(["ibr", "pf", "sssa", "ts"]);
  });

  it("filters by status and analysis and paginates", () => {
    const converged = engine.list({ pageSize: 100, status: ["converged"] });
    expect(converged.items.every((item) => item.status === "converged")).toBe(true);

    const ibr = engine.list({ pageSize: 100, analysis: ["ibr"] });
    expect(ibr.items.every((item) => item.analysis === "ibr")).toBe(true);

    const firstPage = engine.list({ pageSize: 5, page: 1 });
    const secondPage = engine.list({ pageSize: 5, page: 2 });
    expect(firstPage.items).toHaveLength(5);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });

  it("searches across id, case and solver", () => {
    const result = engine.list({ pageSize: 100, search: "ieee14" });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => `${item.id} ${item.caseId} ${item.caseName} ${item.solver}`.toLowerCase().includes("ieee14"))).toBe(
      true,
    );
  });

  it("queues a submitted run, streams telemetry, and produces a result", async () => {
    vi.useRealTimers();
    const detail = engine.submit(pfRequest(), "tester@grid.local");
    expect(detail.status).toBe("queued");
    expect(engine.result(detail.id)).toBeNull();

    const seen: RunStreamEvent[] = [];
    const unsubscribe = engine.subscribe(detail.id, 0, (event) => seen.push(event));
    expect(unsubscribe).not.toBeNull();

    const finished = await new Promise<RunStreamEvent | undefined>((resolve) => {
      const deadline = Date.now() + 30_000;
      const timer = setInterval(() => {
        const done = seen.find((event) => event.type === "done");
        if (done || Date.now() > deadline) {
          clearInterval(timer);
          resolve(done);
        }
      }, 100);
    });

    unsubscribe?.();
    expect(finished).toBeDefined();
    expect(seen.some((event) => event.type === "samples")).toBe(true);
    expect(seen.some((event) => event.type === "log")).toBe(true);
    expect(seen.some((event) => event.type === "progress")).toBe(true);

    const payload = engine.result(detail.id);
    expect(payload).not.toBeNull();
    expect(payload?.result.kind).toBe("pf");
    if (payload?.result.kind === "pf") {
      expect(payload.result.buses.length).toBe(14);
      expect(payload.result.branches.length).toBe(20);
      expect(payload.result.converged).toBe(true);
    }
    expect(engine.get(detail.id)?.status).toBe("converged");
  }, 40_000);

  it("cancels a running job and keeps partial samples", async () => {
    const detail = engine.submit(
      {
        config: {
          analysis: "ibr",
          case: "ieee14_switch",
          options: { ...DEFAULT_IBR_OPTIONS, ibr_analysis: "full", t_end: 6, dt: 0.002 },
        },
      },
      "tester@grid.local",
    );

    const events: RunStreamEvent[] = [];
    const unsubscribe = engine.subscribe(detail.id, 0, (event) => events.push(event));

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (events.some((event) => event.type === "samples")) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });

    const cancelled = engine.cancel(detail.id, "tester@grid.local");
    unsubscribe?.();

    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.reason).toBe("cancelled_by_user");
    expect(cancelled?.progress.fraction).toBeLessThan(1);

    const payload = engine.result(detail.id);
    expect(payload).not.toBeNull();
    if (payload && (payload.result.kind === "switching" || payload.result.kind === "tds")) {
      expect(payload.result.steps).toBeGreaterThan(0);
      expect(payload.result.converged).toBe(false);
      expect(payload.result.time.length).toBe(payload.result.steps);
    }

    const audit = engine.audit({ pageSize: 100, runId: detail.id });
    expect(audit.items.some((entry) => entry.action === "run.cancel")).toBe(true);
  }, 40_000);

  it("resumes a subscription from a sequence cursor without replaying old batches", async () => {
    const detail = engine.submit(pfRequest(), "tester@grid.local");
    const first: RunStreamEvent[] = [];
    const unsubscribe = engine.subscribe(detail.id, 0, (event) => first.push(event));
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (first.filter((event) => event.type === "samples").length >= 1) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
    unsubscribe?.();

    const lastSeq = Math.max(
      ...first.flatMap((event) =>
        event.type === "samples" ? [event.chunk.seq] : event.type === "log" ? event.records.map((record) => record.seq) : [0],
      ),
    );

    const resumed: RunStreamEvent[] = [];
    const stop = engine.subscribe(detail.id, lastSeq, (event) => resumed.push(event));
    stop?.();

    const snapshot = resumed.find((event) => event.type === "snapshot");
    expect(snapshot).toBeDefined();
    if (snapshot?.type === "snapshot") {
      expect(snapshot.chunks.every((chunk) => chunk.seq > lastSeq)).toBe(true);
      expect(snapshot.logs.every((record) => record.seq > lastSeq)).toBe(true);
    }
    engine.cancel(detail.id, "tester@grid.local");
  }, 40_000);

  it("rejects results for unknown runs and reports health", () => {
    expect(engine.get("run-9999")).toBeNull();
    expect(engine.result("run-9999")).toBeNull();
    const health = engine.health();
    expect(health.workers.length).toBeGreaterThan(0);
    expect(["ok", "degraded", "down"]).toContain(health.status);
  });

  it("stores and deletes presets", () => {
    const preset = engine.savePreset(
      {
        name: "integration preset",
        description: "unit test",
        shared: false,
        config: { analysis: "pf", case: "ieee14", options: { ...DEFAULT_PF_OPTIONS } },
      },
      "tester@grid.local",
    );
    expect(engine.presets().some((item) => item.id === preset.id)).toBe(true);
    expect(engine.deletePreset(preset.id)).toBe(true);
    expect(engine.presets().some((item) => item.id === preset.id)).toBe(false);
  });
});
