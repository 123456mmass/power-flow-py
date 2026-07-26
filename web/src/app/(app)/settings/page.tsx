import type { Metadata } from "next";

import { SettingsPanels } from "@/components/settings/settings-panels";
import { getAuthAdapter } from "@/server/auth/mock-adapter";
import { getSessionUser } from "@/server/auth/session";
import { readHealth } from "@/server/data";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();
  const health = await readHealth();
  const adapter = getAuthAdapter();

  return (
    <SettingsPanels
      user={{ name: user?.name ?? "", email: user?.email ?? "", role: user?.role ?? "viewer" }}
      adapterId={adapter.id}
      apiBase={process.env.NEXT_PUBLIC_SOLVER_API_BASE ?? "/api"}
      health={health}
    />
  );
}
