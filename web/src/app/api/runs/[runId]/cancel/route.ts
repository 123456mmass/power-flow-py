import { NextResponse } from "next/server";

import { canMutate, jsonError, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!canMutate(guard.user)) return jsonError("forbidden", "Your role cannot cancel runs.", 403);
  const { runId } = await params;
  const detail = getEngine().cancel(runId, guard.user.email);
  if (!detail) return jsonError("run_not_found", `Run '${runId}' does not exist.`, 404);
  return NextResponse.json(detail);
}
