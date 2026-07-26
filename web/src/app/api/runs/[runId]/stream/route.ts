import type { RunStreamEvent } from "@/lib/domain/types";
import { jsonError, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events for one run.
 *
 * `?fromSeq=N` resumes after the last received log/sample sequence so a dropped
 * connection loses no samples. Heartbeat comments keep intermediaries from
 * buffering or idling the connection out.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;

  const { runId } = await params;
  const url = new URL(request.url);
  const fromSeq = Number.parseInt(url.searchParams.get("fromSeq") ?? "0", 10) || 0;
  const engine = getEngine();
  if (!engine.get(runId)) return jsonError("run_not_found", `Run '${runId}' does not exist.`, 404);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (event: RunStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
          return;
        }
        if (event.type === "done") cleanup();
      };

      controller.enqueue(encoder.encode(": stream open\n\n"));
      unsubscribe = engine.subscribe(runId, fromSeq, send);
      if (!unsubscribe) {
        send({ type: "error", runId, code: "run_not_found", message: "Run disappeared before the stream opened." });
        cleanup();
        return;
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
