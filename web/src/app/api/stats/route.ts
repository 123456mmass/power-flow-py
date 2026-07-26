import { NextResponse } from "next/server";

import { requireUser } from "@/server/api/helpers";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json(getEngine().stats(), { headers: { "cache-control": "no-store" } });
}
