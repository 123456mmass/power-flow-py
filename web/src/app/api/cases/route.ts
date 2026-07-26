import { NextResponse } from "next/server";

import { ALL_CASES } from "@/lib/domain/catalog";
import { requireUser } from "@/server/api/helpers";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  return NextResponse.json(ALL_CASES);
}
