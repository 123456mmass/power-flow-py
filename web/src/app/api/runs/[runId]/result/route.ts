import { NextResponse } from "next/server";

import { jsonError, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const { runId } = await params;
  const engine = getEngine();
  const detail = engine.get(runId);
  if (!detail) return jsonError("run_not_found", `Run '${runId}' does not exist.`, 404);
  const payload = engine.result(runId);
  if (!payload) {
    return jsonError("run_incomplete", `Run '${runId}' is still ${detail.status}; results are not final.`, 409);
  }
  return NextResponse.json(payload, { headers: { "cache-control": "no-store" } });
}
