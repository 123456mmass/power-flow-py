import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthAdapter } from "@/server/auth/mock-adapter";
import {
  SESSION_COOKIE,
  SESSION_TTL_REMEMBER,
  SESSION_TTL_SHORT,
  encodeSession,
  sessionCookieOptions,
} from "@/server/auth/session";
import { getEngine } from "@/server/mock/engine";
import { jsonError } from "@/server/api/helpers";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  remember: z.boolean().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid_body", "Expected a JSON body.", 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError("validation_error", issue?.message ?? "Invalid credentials payload.", 422, issue?.path.join("."));
  }

  const outcome = await getAuthAdapter().authenticate(parsed.data.email, parsed.data.password);
  if (!outcome.ok) {
    const status = outcome.code === "rate_limited" ? 429 : outcome.code === "account_locked" ? 423 : 401;
    return NextResponse.json(
      {
        code: outcome.code,
        message: outcome.message,
        ...(outcome.retryAfterS ? { retryAfterS: outcome.retryAfterS } : {}),
        ...(outcome.attemptsLeft !== undefined ? { attemptsLeft: outcome.attemptsLeft } : {}),
      },
      { status },
    );
  }

  const ttl = parsed.data.remember ? SESSION_TTL_REMEMBER : SESSION_TTL_SHORT;
  const response = NextResponse.json({ user: outcome.user, adapter: getAuthAdapter().id });
  response.cookies.set(SESSION_COOKIE, encodeSession(outcome.user, ttl), sessionCookieOptions(ttl));
  getEngine().appendAudit({
    user: outcome.user.email,
    action: "login",
    runId: null,
    detail: `Signed in via ${getAuthAdapter().id}`,
  });
  return response;
}
