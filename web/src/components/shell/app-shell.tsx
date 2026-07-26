"use client";

import { useCallback, useEffect, useState } from "react";

import { TooltipProvider } from "@/components/ui/overlay";
import { cn } from "@/lib/utils/cn";

import { Breadcrumbs } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { TopBar, type SessionUser } from "./topbar";

const COLLAPSE_KEY = "pfw-sidebar-collapsed";

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSE_KEY);
    if (stored === "true") setCollapsed(true);
    else if (stored === null && window.innerWidth < 1180) setCollapsed(true);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      window.localStorage.setItem(COLLAPSE_KEY, String(!current));
      return !current;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleCollapsed();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-surface-0">
        <div className="hidden md:block">
          <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />
        </div>

        {mobileNavOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-black/55"
            />
            <div className="absolute left-0 top-0 h-full" onClick={() => setMobileNavOpen(false)}>
              <Sidebar collapsed={false} onToggle={() => setMobileNavOpen(false)} className="shadow-2xl" />
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar user={user} onOpenPalette={() => setPaletteOpen(true)} onOpenNav={() => setMobileNavOpen(true)} />
          <div className="flex h-7 shrink-0 items-center border-b border-line bg-surface-1/60 px-3 no-print">
            <Breadcrumbs />
          </div>
          <main id="main" className={cn("min-w-0 flex-1 overflow-auto")}>
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </TooltipProvider>
  );
}
