import { NextResponse } from "next/server";

import { getAuthAdapter } from "@/server/auth/mock-adapter";
import { jsonError } from "@/server/api/helpers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email : "";
  } catch {
    return jsonError("invalid_body", "Expected a JSON body.", 400);
  }
  const adapter = getAuthAdapter();
  if (!adapter.supportsPasswordReset) {
    return jsonError("unsupported", "The active identity adapter does not support self-service reset.", 501);
  }
  return NextResponse.json(await adapter.requestPasswordReset(email));
}
