import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/session";
import { getEngine } from "@/server/mock/engine";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const user = await getSessionUser();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  if (user) {
    getEngine().appendAudit({ user: user.email, action: "logout", runId: null, detail: "Signed out" });
  }
  return response;
}
