import { NextResponse } from "next/server";

import { canMutate, jsonError, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ presetId: string }> },
): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!canMutate(guard.user)) return jsonError("forbidden", "Your role cannot delete presets.", 403);
  const { presetId } = await params;
  if (!getEngine().deletePreset(presetId)) {
    return jsonError("preset_not_found", `Preset '${presetId}' does not exist.`, 404);
  }
  return new NextResponse(null, { status: 204 });
}
