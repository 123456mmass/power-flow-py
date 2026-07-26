"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Tooltip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils/cn";

import { NAV_ITEMS } from "./nav-items";

export function Sidebar({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  const isActive = (href: string, match?: string[]) => {
    if (pathname === href) return true;
    const prefixes = match ?? [href];
    return prefixes.some((prefix) => pathname.startsWith(`${prefix}/`) || pathname === prefix);
  };

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex h-full flex-col border-r border-line bg-surface-1 transition-[width] duration-150",
        collapsed ? "w-[52px]" : "w-[212px]",
        className,
      )}
    >
      <div className={cn("flex h-11 items-center gap-2 border-b border-line px-2.5", collapsed && "justify-center px-0")}>
        <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-[3px] bg-primary text-[11px] font-bold text-primary-fg">
          PF
        </span>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold leading-tight text-fg">Grid Analysis</p>
            <p className="truncate text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">Console</p>
          </div>
        ) : null}
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href, item.match);
          const link = (
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded px-2 py-1.5 text-[12.5px] transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-primary-soft text-fg shadow-[inset_2px_0_0_0_var(--primary)]"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <item.icon aria-hidden className={cn("size-4 shrink-0", active ? "text-primary" : "text-fg-subtle group-hover:text-fg-muted")} />
              {!collapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
            </Link>
          );
          return (
            <li key={item.href}>
              {collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line p-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-[12px] text-fg-subtle hover:bg-surface-2 hover:text-fg",
            "focus-visible:outline-2 focus-visible:outline-focus",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <PanelLeftOpen aria-hidden className="size-4" /> : <PanelLeftClose aria-hidden className="size-4" />}
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </nav>
  );
}
