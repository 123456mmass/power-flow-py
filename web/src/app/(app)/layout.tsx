import { redirect } from "next/navigation";

import { AppShell } from "@/components/shell/app-shell";
import { getSessionUser } from "@/server/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <AppShell user={{ name: user.name, email: user.email, role: user.role, initials: user.initials }}>
      {children}
    </AppShell>
  );
}
