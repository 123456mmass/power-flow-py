import { NextResponse } from "next/server";

import { getAuthAdapter } from "@/server/auth/mock-adapter";
import { getSessionUser } from "@/server/auth/session";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  return NextResponse.json({
    user,
    adapter: getAuthAdapter().id,
    supportsPasswordReset: getAuthAdapter().supportsPasswordReset,
  });
}
