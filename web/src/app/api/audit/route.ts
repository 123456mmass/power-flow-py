import { NextResponse } from "next/server";

import { parseIntOr, requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  const url = new URL(request.url);
  const page = getEngine().audit({
    page: parseIntOr(url.searchParams.get("page"), 1),
    pageSize: parseIntOr(url.searchParams.get("pageSize"), 25),
    search: url.searchParams.get("search") ?? undefined,
    action: url.searchParams.get("action") ?? undefined,
    runId: url.searchParams.get("runId") ?? undefined,
  });
  return NextResponse.json(page, { headers: { "cache-control": "no-store" } });
}
