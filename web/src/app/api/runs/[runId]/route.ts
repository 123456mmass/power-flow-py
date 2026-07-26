import { NextResponse } from "next/server";

import { canMutate, jsonError, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const { runId } = await params;
  const detail = getEngine().get(runId);
  if (!detail) return jsonError("run_not_found", `Run '${runId}' does not exist.`, 404);
  return NextResponse.json(detail, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!canMutate(guard.user)) return jsonError("forbidden", "Your role cannot delete runs.", 403);
  const { runId } = await params;
  const removed = getEngine().delete(runId, guard.user.email);
  if (!removed) return jsonError("run_not_found", `Run '${runId}' does not exist.`, 404);
  return new NextResponse(null, { status: 204 });
}
