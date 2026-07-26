/**
 * Replaceable authentication port.
 *
 * No production identity vendor is hard-coded. The bundled implementation is an
 * in-memory adapter for local development; swapping in OIDC, LDAP, SAML or a
 * corporate gateway means providing another `AuthAdapter` and returning it from
 * `getAuthAdapter()`.
 */

export type UserRole = "engineer" | "analyst" | "viewer" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  initials: string;
}

export type AuthFailureCode =
  | "invalid_credentials"
  | "account_locked"
  | "rate_limited"
  | "adapter_unavailable";

export type AuthOutcome =
  | { ok: true; user: AuthUser }
  | { ok: false; code: AuthFailureCode; message: string; retryAfterS?: number; attemptsLeft?: number };

export interface AuthAdapter {
  /** Stable id surfaced in the UI so operators know which port is active. */
  readonly id: string;
  readonly supportsPasswordReset: boolean;
  authenticate(email: string, password: string): Promise<AuthOutcome>;
  findById(userId: string): Promise<AuthUser | null>;
  requestPasswordReset(email: string): Promise<{ ok: boolean; message: string }>;
}
