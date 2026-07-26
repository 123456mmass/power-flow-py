import { createHash, timingSafeEqual } from "node:crypto";

import { DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";

import type { AuthAdapter, AuthOutcome, AuthUser } from "./adapter";

interface MockAccount extends AuthUser {
  /** sha256 of the demo password; no plaintext secret is stored. */
  passwordHash: string;
  locked: boolean;
}

const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_S = 900;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function account(
  id: string,
  email: string,
  name: string,
  role: AuthUser["role"],
  password: string,
  locked = false,
): MockAccount {
  const initials = name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return { id, email, name, role, initials, passwordHash: sha256(password), locked };
}

/**
 * Demo credentials are intentionally weak and only meaningful for local
 * development. They are surfaced in the UI only when
 * `NEXT_PUBLIC_ENABLE_DEMO_CREDENTIALS=true`.
 */
export class InMemoryAuthAdapter implements AuthAdapter {
  readonly id = "in-memory-dev";
  readonly supportsPasswordReset = true;

  private readonly accounts = new Map<string, MockAccount>();
  private readonly failures = new Map<string, { count: number; firstAt: number }>();

  constructor() {
    for (const item of DEMO_ACCOUNTS) {
      this.accounts.set(
        item.email,
        account(item.id, item.email, item.name, item.role, item.password, item.locked),
      );
    }
  }

  async authenticate(email: string, password: string): Promise<AuthOutcome> {
    const key = email.trim().toLowerCase();
    const found = this.accounts.get(key);
    const now = Date.now();
    const failure = this.failures.get(key);

    if (failure && failure.count >= MAX_ATTEMPTS) {
      const elapsed = (now - failure.firstAt) / 1000;
      if (elapsed < LOCK_WINDOW_S) {
        return {
          ok: false,
          code: "rate_limited",
          message: "Too many failed sign-in attempts. Try again later or contact the study administrator.",
          retryAfterS: Math.ceil(LOCK_WINDOW_S - elapsed),
        };
      }
      this.failures.delete(key);
    }

    if (!found || !constantTimeEquals(found.passwordHash, sha256(password))) {
      const next = failure && now - failure.firstAt < LOCK_WINDOW_S * 1000
        ? { count: failure.count + 1, firstAt: failure.firstAt }
        : { count: 1, firstAt: now };
      this.failures.set(key, next);
      return {
        ok: false,
        code: "invalid_credentials",
        message: "Email or password is incorrect.",
        attemptsLeft: Math.max(0, MAX_ATTEMPTS - next.count),
      };
    }

    if (found.locked) {
      return {
        ok: false,
        code: "account_locked",
        message: "This account is locked by the study administrator. Contact operations to restore access.",
      };
    }

    this.failures.delete(key);
    return { ok: true, user: this.toUser(found) };
  }

  async findById(userId: string): Promise<AuthUser | null> {
    for (const item of this.accounts.values()) {
      if (item.id === userId) return this.toUser(item);
    }
    return null;
  }

  async requestPasswordReset(email: string): Promise<{ ok: boolean; message: string }> {
    return {
      ok: true,
      message: `If ${email.trim() || "the address"} exists, a reset link has been queued by the identity adapter.`,
    };
  }

  private toUser(item: MockAccount): AuthUser {
    return { id: item.id, email: item.email, name: item.name, role: item.role, initials: item.initials };
  }
}

let adapter: AuthAdapter | null = null;

export function getAuthAdapter(): AuthAdapter {
  if (!adapter) adapter = new InMemoryAuthAdapter();
  return adapter;
}

/** Replace the active adapter (composition root / tests). */
export function setAuthAdapter(next: AuthAdapter | null): void {
  adapter = next;
}
