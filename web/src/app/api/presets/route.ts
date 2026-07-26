import { NextResponse } from "next/server";
import { z } from "zod";

import { analysisConfigSchema, fieldErrors } from "@/lib/domain/config-schema";
import { canMutate, jsonError, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

const presetSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  description: z.string().max(280).default(""),
  shared: z.boolean().default(false),
  config: analysisConfigSchema,
});

export async function GET(): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json(getEngine().presets());
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!canMutate(guard.user)) return jsonError("forbidden", "Your role cannot save presets.", 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = presetSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "validation_error", message: "Invalid preset.", errors: fieldErrors(parsed.error) },
      { status: 422 },
    );
  }
  const preset = getEngine().savePreset(parsed.data as never, guard.user.email);
  return NextResponse.json(preset, { status: 201 });
}
