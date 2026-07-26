import { NextResponse } from "next/server";

import type { AuthUser } from "@/server/auth/adapter";
import { getSessionUser } from "@/server/auth/session";

export function jsonError(code: string, message: string, status: number, field?: string): NextResponse {
  return NextResponse.json({ code, message, ...(field ? { field } : {}) }, { status });
}

export async function requireUser(): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) {
    return { response: jsonError("unauthenticated", "Sign in to access the solver API.", 401) };
  }
  return { user };
}

export function canMutate(user: AuthUser): boolean {
  return user.role === "engineer" || user.role === "admin";
}

export function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseIntOr(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
