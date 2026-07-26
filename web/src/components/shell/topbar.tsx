"use client";

import { Bell, LogOut, Menu, Search, ShieldCheck, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/feedback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from "@/components/ui/overlay";
import type { HealthReport, RunSummary } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { formatRelative } from "@/lib/utils/format";

export interface SessionUser {
  name: string;
  email: string;
  role: string;
  initials: string;
}

function ConnectionIndicator() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (!response.ok) throw new Error("health failed");
        const payload = (await response.json()) as HealthReport;
        if (!active) return;
        setHealth(payload);
        setFailed(false);
      } catch {
        if (active) setFailed(true);
      }
    };
    void poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const tone = failed || !health ? "danger" : health.status === "ok" ? "ok" : "warn";
  const label = failed ? "Backend unreachable" : !health ? "Connecting…" : health.status === "ok" ? "Solver online" : "Degraded";
  const online = health?.workers.filter((worker) => worker.status !== "offline").length ?? 0;

  return (
    <Tooltip
      content={
        failed || !health
          ? "The solver service is not responding. Streams will retry automatically."
          : `${online}/${health.workers.length} workers online · queue ${health.queueDepth} · ${health.solverVersion}`
      }
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-1 text-[11.5px] text-fg-muted hover:border-line-strong focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            tone === "ok" && "bg-ok live-dot",
            tone === "warn" && "bg-warn live-dot",
            tone === "danger" && "bg-danger",
          )}
        />
        <span className="hidden sm:inline">{label}</span>
        {health ? <span className="num hidden text-fg-subtle md:inline">{online}/{health.workers.length}</span> : null}
      </button>
    </Tooltip>
  );
}

function NotificationsMenu() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/runs?pageSize=6", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { items: RunSummary[] };
        if (active) setRuns(payload.items);
      } catch {
        /* offline: the connection indicator already reports this */
      }
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const attention = runs.filter((run) => run.status === "failed" || run.warnings > 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications: ${attention.length} needing attention`}
          className="relative inline-flex size-8 items-center justify-center rounded text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Bell aria-hidden className="size-4" />
          {attention.length > 0 ? (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-warn" />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[320px]">
        <DropdownMenuLabel>Recent activity</DropdownMenuLabel>
        {runs.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-fg-subtle">No recent runs.</p>
        ) : (
          runs.map((run) => (
            <DropdownMenuItem key={run.id} onSelect={() => router.push(`/runs/${run.id}`)}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[12.5px]">{run.label}</span>
                <span className="num text-[11px] text-fg-subtle">
                  {run.id} · {run.status} · {formatRelative(run.startedAt)}
                </span>
              </span>
              {run.warnings > 0 ? <Badge tone="warn">{run.warnings}</Badge> : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
    } finally {
      setPending(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded border border-line bg-surface-2 py-1 pl-1 pr-2 text-[12px] text-fg hover:border-line-strong focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span aria-hidden className="grid size-6 place-items-center rounded-[3px] bg-primary-soft text-[11px] font-semibold text-primary">
            {user.initials}
          </span>
          <span className="hidden max-w-[120px] truncate lg:inline">{user.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuItem disabled>
          <ShieldCheck aria-hidden className="size-3.5" />
          Role: {user.role}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <User aria-hidden className="size-3.5" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive disabled={pending} onSelect={() => void signOut()}>
          <LogOut aria-hidden className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar({
  user,
  onOpenPalette,
  onOpenNav,
}: {
  user: SessionUser;
  onOpenPalette: () => void;
  onOpenNav: () => void;
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-2">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="inline-flex size-8 items-center justify-center rounded text-fg-muted hover:bg-surface-2 md:hidden"
      >
        <Menu aria-hidden className="size-4" />
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        className="group flex h-7 min-w-0 flex-1 max-w-[420px] items-center gap-2 rounded border border-line bg-surface-inset px-2 text-left text-[12.5px] text-fg-subtle hover:border-line-strong focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Search aria-hidden className="size-3.5" />
        <span className="truncate">Search cases, runs, actions…</span>
        <kbd className="num ml-auto hidden rounded border border-line px-1 text-[10.5px] text-fg-subtle sm:inline">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <ConnectionIndicator />
        <NotificationsMenu />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
