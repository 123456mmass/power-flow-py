"use client";

import { AlertTriangle, ArrowRight, KeyRound, Lock, ShieldAlert, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { Checkbox, Field, TextInput } from "@/components/ui/inputs";
import { Dialog } from "@/components/ui/overlay";
import { DEMO_ACCOUNTS, demoCredentialsEnabled } from "@/lib/auth/demo-accounts";
import { cn } from "@/lib/utils/cn";

interface LoginFormProps {
  adapterId: string;
  supportsPasswordReset: boolean;
  solverVersion: string;
  workersOnline: number;
  workersTotal: number;
  backendStatus: "ok" | "degraded" | "down";
}

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string; attemptsLeft?: number }
  | { kind: "locked"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterS?: number };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm({
  adapterId,
  supportsPasswordReset,
  solverVersion,
  workersOnline,
  workersTotal,
  backendStatus,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({ email: false, password: false });
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const emailError = touched.email
    ? email.trim().length === 0
      ? "Email is required"
      : !EMAIL_PATTERN.test(email.trim())
        ? "Enter a valid email address"
        : undefined
    : undefined;
  const passwordError = touched.password && password.length === 0 ? "Password is required" : undefined;
  const submitting = state.kind === "submitting";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched({ email: true, password: true });
    if (email.trim().length === 0 || !EMAIL_PATTERN.test(email.trim()) || password.length === 0) return;

    setState({ kind: "submitting" });
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, remember }),
      });
      if (response.ok) {
        router.replace("/dashboard");
        return;
      }
      const body = (await response.json()) as {
        code?: string;
        message?: string;
        retryAfterS?: number;
        attemptsLeft?: number;
      };
      if (response.status === 423) {
        setState({ kind: "locked", message: body.message ?? "This account is locked." });
      } else if (response.status === 429) {
        setState({
          kind: "rate_limited",
          message: body.message ?? "Too many attempts.",
          ...(body.retryAfterS !== undefined ? { retryAfterS: body.retryAfterS } : {}),
        });
      } else {
        setState({
          kind: "error",
          message: body.message ?? "Sign-in failed.",
          ...(body.attemptsLeft !== undefined ? { attemptsLeft: body.attemptsLeft } : {}),
        });
      }
    } catch {
      setState({ kind: "error", message: "Cannot reach the authentication service. Check your connection." });
    }
  };

  const requestReset = async () => {
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: resetEmail || email }),
      });
      const body = (await response.json()) as { message?: string };
      setResetMessage(body.message ?? "Request submitted.");
    } catch {
      setResetMessage("The identity adapter is unreachable.");
    }
  };

  const fillDemo = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setState({ kind: "idle" });
    setTouched({ email: false, password: false });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_460px]">
      {/* Technical context column — deliberately not marketing content. */}
      <aside className="relative hidden flex-col justify-between border-r border-line bg-surface-1 p-8 lg:flex">
        <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="grid size-8 place-items-center rounded bg-primary text-[13px] font-bold text-primary-fg">
              PF
            </span>
            <div>
              <p className="text-[14px] font-semibold leading-tight">Grid Analysis Console</p>
              <p className="text-[11.5px] uppercase tracking-[0.09em] text-fg-subtle">Power-system study workbench</p>
            </div>
          </div>

          <dl className="mt-10 grid max-w-lg grid-cols-2 gap-x-6 gap-y-3 text-[12.5px]">
            {[
              ["AC power flow", "Newton-Raphson · Gauss-Seidel · FDPF-XB/BX · radial BFS"],
              ["Small-signal stability", "Eigenvalues, damping ratios, oscillatory modes"],
              ["Time-domain simulation", "Trapezoidal · RK4 · backward Euler with fault events"],
              ["IBR studies", "GFL/GFM, AGSI++ switching, grid and fault events"],
              ["Multi-bus switching", "IEEE 14-bus: 1 SG + 4 switchable IBRs"],
              ["Reference systems", "Kundur and Padiyar two-area studies"],
            ].map(([term, detail]) => (
              <div key={term} className="border-l border-line pl-3">
                <dt className="font-medium text-fg">{term}</dt>
                <dd className="text-fg-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative space-y-2 text-[11.5px] text-fg-subtle">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                backendStatus === "ok" ? "bg-ok live-dot" : backendStatus === "degraded" ? "bg-warn live-dot" : "bg-danger",
              )}
            />
            <span className="num">
              {solverVersion} · workers {workersOnline}/{workersTotal} · adapter {adapterId}
            </span>
          </div>
          <p className="max-w-lg">
            Numerical algorithms execute only in the solver service. This console submits configurations, streams job
            telemetry and renders results.
          </p>
        </div>
      </aside>

      <main id="main" className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-[360px]">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span aria-hidden className="grid size-7 place-items-center rounded bg-primary text-[12px] font-bold text-primary-fg">
              PF
            </span>
            <p className="text-[14px] font-semibold">Grid Analysis Console</p>
          </div>

          <h1 className="text-[19px] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            Authenticate against the configured identity adapter to dispatch and inspect studies.
          </p>

          <form onSubmit={submit} noValidate className="mt-6 space-y-3.5">
            {state.kind === "locked" ? (
              <div role="alert" className="flex items-start gap-2.5 rounded border border-danger/40 bg-danger-soft px-3 py-2.5">
                <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                <div>
                  <p className="text-[12.5px] font-semibold text-danger">Account locked</p>
                  <p className="mt-0.5 text-[12.5px] text-fg-muted">{state.message}</p>
                </div>
              </div>
            ) : null}

            {state.kind === "rate_limited" ? (
              <div role="alert" className="flex items-start gap-2.5 rounded border border-warn/40 bg-warn-soft px-3 py-2.5">
                <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
                <div>
                  <p className="text-[12.5px] font-semibold text-warn">Temporarily blocked</p>
                  <p className="mt-0.5 text-[12.5px] text-fg-muted">
                    {state.message}
                    {state.retryAfterS ? ` Retry in ${Math.ceil(state.retryAfterS / 60)} min.` : ""}
                  </p>
                </div>
              </div>
            ) : null}

            {state.kind === "error" ? (
              <div role="alert" className="flex items-start gap-2.5 rounded border border-danger/40 bg-danger-soft px-3 py-2.5">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
                <div>
                  <p className="text-[12.5px] font-semibold text-danger">Sign-in failed</p>
                  <p className="mt-0.5 text-[12.5px] text-fg-muted">
                    {state.message}
                    {state.attemptsLeft !== undefined ? ` ${state.attemptsLeft} attempt(s) left before lockout.` : ""}
                  </p>
                </div>
              </div>
            ) : null}

            <Field label="Email" htmlFor="email" error={emailError} required>
              <TextInput
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                placeholder="engineer@grid.local"
                value={email}
                invalid={Boolean(emailError)}
                aria-describedby={emailError ? "email-error" : undefined}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={() => setTouched((current) => ({ ...current, email: true }))}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={passwordError} required>
              <TextInput
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••••"
                value={password}
                invalid={Boolean(passwordError)}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => setTouched((current) => ({ ...current, password: true }))}
              />
            </Field>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              <Checkbox
                checked={remember}
                onCheckedChange={setRemember}
                label="Remember this workstation"
                id="remember"
              />
              {supportsPasswordReset ? (
                <button
                  type="button"
                  onClick={() => setResetOpen(true)}
                  className="text-[12px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  Forgot password?
                </button>
              ) : null}
            </div>

            <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full justify-center">
              {submitting ? "Authenticating…" : "Sign in"}
              {!submitting ? <ArrowRight aria-hidden className="size-4" /> : null}
            </Button>
          </form>

          {demoCredentialsEnabled() ? (
            <section className="mt-6 rounded border border-dashed border-warn/50 bg-warn-soft/40 p-3">
              <header className="flex items-center gap-2">
                <AlertTriangle aria-hidden className="size-3.5 text-warn" />
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-warn">
                  Local development credentials
                </h2>
                <Badge tone="warn" className="ml-auto">
                  dev only
                </Badge>
              </header>
              <p className="mt-1.5 text-[11.5px] text-fg-muted">
                Shown because <code className="num">NEXT_PUBLIC_ENABLE_DEMO_CREDENTIALS=true</code>. Remove the flag for any
                shared deployment.
              </p>
              <ul className="mt-2 space-y-1">
                {DEMO_ACCOUNTS.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      onClick={() => fillDemo(account.email, account.password)}
                      className="flex w-full items-center gap-2 rounded border border-line bg-surface-1 px-2 py-1.5 text-left hover:border-primary/60 focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      <KeyRound aria-hidden className="size-3 shrink-0 text-fg-subtle" />
                      <span className="num min-w-0 flex-1 truncate text-[11.5px] text-fg">{account.email}</span>
                      <span className="hidden text-[11px] text-fg-subtle sm:inline">{account.role}</span>
                      {account.locked ? <Badge tone="danger">locked</Badge> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="mt-6 text-[11px] text-fg-subtle">
            Identity adapter: <span className="num">{adapterId}</span>. Swap the <code className="num">AuthAdapter</code>{" "}
            implementation to integrate OIDC, SAML or LDAP without touching UI code.
          </p>
        </div>
      </main>

      <Dialog
        open={resetOpen}
        onOpenChange={(open) => {
          setResetOpen(open);
          if (!open) setResetMessage(null);
        }}
        title="Request a password reset"
        description="The active identity adapter decides how reset links are delivered."
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void requestReset()}>
              Send request
            </Button>
          </>
        }
      >
        <Field label="Work email" htmlFor="reset-email">
          <TextInput
            id="reset-email"
            type="email"
            placeholder={email || "engineer@grid.local"}
            value={resetEmail}
            onChange={(event) => setResetEmail(event.target.value)}
          />
        </Field>
        {resetMessage ? (
          <p role="status" className="mt-3 rounded border border-line bg-surface-2 px-2.5 py-2 text-[12px] text-fg-muted">
            {resetMessage}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
