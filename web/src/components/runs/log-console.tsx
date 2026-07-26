"use client";

import { Copy, Download, Pause, Play, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { LOG_LEVELS, type LogLevel, type LogRecord } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";
import { downloadBlob, formatClock } from "@/lib/utils/format";

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "text-fg-subtle",
  info: "text-info",
  warn: "text-warn",
  error: "text-danger",
};

const MAX_RENDERED = 800;

export function LogConsole({
  logs,
  runId,
  height = "18rem",
  className,
}: {
  logs: LogRecord[];
  runId: string;
  height?: string;
  className?: string;
}) {
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(LOG_LEVELS));
  const [query, setQuery] = useState("");
  const [autoscroll, setAutoscroll] = useState(true);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return logs.filter(
      (record) =>
        levels.has(record.level) &&
        (needle === "" || record.message.toLowerCase().includes(needle) || record.source.toLowerCase().includes(needle)),
    );
  }, [levels, logs, query]);

  const rendered = filtered.length > MAX_RENDERED ? filtered.slice(-MAX_RENDERED) : filtered;

  useEffect(() => {
    if (!autoscroll) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [autoscroll, rendered.length]);

  const asText = () =>
    filtered
      .map((record) => `${record.at} ${record.level.toUpperCase().padEnd(5)} ${record.source.padEnd(12)} ${record.message}`)
      .join("\n");

  return (
    <Panel className={cn("min-w-0", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/50 px-2 py-1.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-muted">Solver log</h3>
        <div className="flex items-center gap-1" role="group" aria-label="Severity filter">
          {LOG_LEVELS.map((level) => {
            const active = levels.has(level);
            return (
              <button
                key={level}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setLevels((current) => {
                    const next = new Set(current);
                    if (next.has(level)) next.delete(level);
                    else next.add(level);
                    return next;
                  })
                }
                className={cn(
                  "rounded border px-1.5 py-[1px] text-[10.5px] font-medium uppercase tracking-[0.05em] focus-visible:outline-2 focus-visible:outline-focus",
                  active
                    ? cn("border-line-strong bg-surface-3", LEVEL_STYLE[level])
                    : "border-line text-fg-subtle opacity-60",
                )}
              >
                {level}
              </button>
            );
          })}
        </div>
        <div className="relative min-w-[140px] flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search log…"
            aria-label="Search log"
            className="h-7 w-full rounded border border-line bg-surface-inset pl-7 pr-2 text-[12px] text-fg placeholder:text-fg-subtle focus:border-primary focus-visible:outline-2 focus-visible:outline-focus"
          />
        </div>
        <span className="num text-[11px] text-fg-subtle">
          {filtered.length} / {logs.length}
        </span>
        <Button
          variant={autoscroll ? "ghost" : "warning"}
          size="sm"
          onClick={() => setAutoscroll((current) => !current)}
          aria-pressed={!autoscroll}
        >
          {autoscroll ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
          {autoscroll ? "Pause scroll" : "Resume"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(asText())}>
          <Copy aria-hidden className="size-3.5" />
          Copy
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadBlob(`${runId}-log.txt`, "text/plain;charset=utf-8", asText())}
        >
          <Download aria-hidden className="size-3.5" />
          Download
        </Button>
      </header>
      <div
        ref={viewportRef}
        role="log"
        aria-live="off"
        aria-label="Solver log output"
        tabIndex={0}
        className="overflow-auto bg-surface-inset px-2 py-1.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        style={{ height }}
      >
        {rendered.length === 0 ? (
          <p className="px-1 py-6 text-center text-[12px] text-fg-subtle">
            {logs.length === 0 ? "Waiting for the first log record…" : "No records match the current filter."}
          </p>
        ) : (
          <ol className="num space-y-[1px] text-[11.5px] leading-[1.55]">
            {filtered.length > MAX_RENDERED ? (
              <li className="px-1 py-1 text-fg-subtle">
                … {filtered.length - MAX_RENDERED} earlier records hidden (download for the full log)
              </li>
            ) : null}
            {rendered.map((record) => (
              <li key={record.seq} className="flex gap-2 whitespace-pre-wrap break-words px-1 hover:bg-surface-2/60">
                <span className="shrink-0 text-fg-subtle">{formatClock(record.at)}</span>
                <span className={cn("w-10 shrink-0 uppercase", LEVEL_STYLE[record.level])}>{record.level}</span>
                <span className="w-[86px] shrink-0 truncate text-fg-subtle">{record.source}</span>
                <span className="min-w-0 flex-1 text-fg">{record.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
