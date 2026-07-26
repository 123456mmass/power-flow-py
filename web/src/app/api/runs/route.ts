import { NextResponse } from "next/server";

import { fieldErrors, runRequestSchema } from "@/lib/domain/config-schema";
import type { AnalysisKind, RunStatus } from "@/lib/domain/types";
import { canMutate, jsonError, parseIntOr, parseList, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const url = new URL(request.url);
  const page = getEngine().list({
    page: parseIntOr(url.searchParams.get("page"), 1),
    pageSize: parseIntOr(url.searchParams.get("pageSize"), 20),
    search: url.searchParams.get("search") ?? undefined,
    status: parseList(url.searchParams.get("status")) as RunStatus[],
    analysis: parseList(url.searchParams.get("analysis")) as AnalysisKind[],
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
    direction: (url.searchParams.get("direction") as "asc" | "desc" | null) ?? undefined,
  });
  return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  if (!canMutate(guard.user)) {
    return jsonError("forbidden", "Your role cannot submit runs. Ask an engineer to dispatch this study.", 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid_body", "Expected a JSON body.", 400);
  }

  const parsed = runRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const first = Object.entries(errors)[0];
    return NextResponse.json(
      {
        code: "validation_error",
        message: first ? `${first[0]}: ${first[1]}` : "Invalid run configuration.",
        errors,
      },
      { status: 422 },
    );
  }

  const detail = getEngine().submit(parsed.data as never, guard.user.email);
  return NextResponse.json(detail, { status: 202 });
}
