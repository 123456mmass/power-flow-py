"use client";

import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import type { SignalDescriptor } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

export function SignalTree({
  signals,
  selected,
  onChange,
  className,
  height = "20rem",
}: {
  signals: SignalDescriptor[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  className?: string;
  height?: string;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map<string, SignalDescriptor[]>();
    for (const signal of signals) {
      if (needle && !`${signal.label} ${signal.group} ${signal.id}`.toLowerCase().includes(needle)) continue;
      const bucket = map.get(signal.group) ?? [];
      bucket.push(signal);
      map.set(signal.group, bucket);
    }
    return [...map.entries()];
  }, [query, signals]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const toggleGroup = (members: SignalDescriptor[]) => {
    const allSelected = members.every((signal) => selected.has(signal.id));
    const next = new Set(selected);
    for (const signal of members) {
      if (allSelected) next.delete(signal.id);
      else next.add(signal.id);
    }
    onChange(next);
  };

  return (
    <Panel className={cn("min-w-0", className)}>
      <header className="space-y-1.5 border-b border-line bg-surface-2/50 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-muted">Signals</h3>
          <span className="num text-[11px] text-fg-subtle">
            {selected.size}/{signals.length}
          </span>
        </div>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search buses, devices, signals…"
            aria-label="Search signals"
            className="h-7 w-full rounded border border-line bg-surface-inset pl-7 pr-2 text-[12px] text-fg placeholder:text-fg-subtle focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => onChange(new Set(signals.map((signal) => signal.id)))}>
            Select all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange(new Set())}>
            Clear
          </Button>
        </div>
      </header>

      <div className="overflow-auto" style={{ height }}>
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-fg-subtle">No signals match “{query}”.</p>
        ) : (
          <ul role="tree" aria-label="Signal tree" className="p-1">
            {groups.map(([group, members]) => {
              const isCollapsed = collapsed.has(group);
              const allSelected = members.every((signal) => selected.has(signal.id));
              const someSelected = !allSelected && members.some((signal) => selected.has(signal.id));
              return (
                <li key={group} role="treeitem" aria-expanded={!isCollapsed} className="mb-0.5">
                  <div className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-2">
                    <button
                      type="button"
                      aria-label={isCollapsed ? `Expand ${group}` : `Collapse ${group}`}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(group)) next.delete(group);
                          else next.add(group);
                          return next;
                        })
                      }
                      className="text-fg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {isCollapsed ? <ChevronRight aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
                    </button>
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(element) => {
                          if (element) element.indeterminate = someSelected;
                        }}
                        onChange={() => toggleGroup(members)}
                        className="size-3 accent-[var(--primary)]"
                      />
                      <span className="truncate text-[12px] font-medium text-fg">{group}</span>
                      <span className="num ml-auto shrink-0 text-[10.5px] text-fg-subtle">{members.length}</span>
                    </label>
                  </div>
                  {!isCollapsed ? (
                    <ul role="group" className="ml-5 border-l border-line pl-1.5">
                      {members.map((signal) => (
                        <li key={signal.id} role="treeitem" aria-selected={selected.has(signal.id)}>
                          <label className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-surface-2">
                            <input
                              type="checkbox"
                              checked={selected.has(signal.id)}
                              onChange={() => toggle(signal.id)}
                              className="size-3 accent-[var(--primary)]"
                            />
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-muted">{signal.label}</span>
                            <span className="num shrink-0 text-[10.5px] text-fg-subtle">{signal.unit}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}
