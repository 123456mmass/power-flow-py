import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getAuthAdapter } from "@/server/auth/mock-adapter";
import { getSessionUser } from "@/server/auth/session";
import { readHealth } from "@/server/data";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  const adapter = getAuthAdapter();
  const health = await readHealth();

  return (
    <LoginForm
      adapterId={adapter.id}
      supportsPasswordReset={adapter.supportsPasswordReset}
      solverVersion={health.solverVersion}
      workersOnline={health.workers.filter((worker) => worker.status !== "offline").length}
      workersTotal={health.workers.length}
      backendStatus={health.status}
    />
  );
}
