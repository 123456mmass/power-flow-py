import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import type { AuthUser } from "./adapter";
import { getAuthAdapter } from "./mock-adapter";

export const SESSION_COOKIE = "pfw_session";

const DEV_SECRET = "development-only-session-secret-change-me";

function secret(): string {
  return process.env.AUTH_SESSION_SECRET ?? DEV_SECRET;
}

interface SessionPayload {
  sub: string;
  email: string;
  name: string;
  role: AuthUser["role"];
  initials: string;
  exp: number;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function encodeSession(user: AuthUser, ttlSeconds: number): string {
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    initials: user.initials,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      initials: payload.initials,
    };
  } catch {
    return null;
  }
}

/** Reads the current user from the request cookies (server components/routes). */
export async function getSessionUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const user = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!user) return null;
  // Confirm the account still exists in the active adapter.
  const fresh = await getAuthAdapter().findById(user.id);
  return fresh ?? user;
}

export function sessionCookieOptions(ttlSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlSeconds,
  };
}

export const SESSION_TTL_SHORT = 60 * 60 * 8;
export const SESSION_TTL_REMEMBER = 60 * 60 * 24 * 30;
