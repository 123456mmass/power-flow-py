import { NextResponse } from "next/server";

import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

/** Unauthenticated liveness probe, intentionally free of run detail. */
export async function GET(): Promise<NextResponse> {
  const health = getEngine().health();
  return NextResponse.json(health, { headers: { "cache-control": "no-store" } });
}
