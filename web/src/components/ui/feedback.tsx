import { AlertTriangle, CheckCircle2, CircleSlash, Clock, Loader2, XCircle } from "lucide-react";

import type { RunStatus } from "@/lib/domain/types";
import { cn } from "@/lib/utils/cn";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "primary";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-3 text-fg-muted",
  ok: "border-ok/40 bg-ok-soft text-ok",
  warn: "border-warn/40 bg-warn-soft text-warn",
  danger: "border-danger/40 bg-danger-soft text-danger",
  info: "border-info/40 bg-info-soft text-info",
  primary: "border-primary/40 bg-primary-soft text-primary",
};

export function Badge({
  tone = "neutral",
  className,
  title,
  children,
}: {
  tone?: Tone;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 py-[1px] text-[11px] font-medium uppercase tracking-[0.05em]",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_META: Record<RunStatus, { tone: Tone; label: string; Icon: typeof CheckCircle2; live?: boolean }> = {
  queued: { tone: "neutral", label: "Queued", Icon: Clock },
  initializing: { tone: "info", label: "Initializing", Icon: Loader2, live: true },
  running: { tone: "primary", label: "Running", Icon: Loader2, live: true },
  converged: { tone: "ok", label: "Converged", Icon: CheckCircle2 },
  failed: { tone: "danger", label: "Failed", Icon: XCircle },
  cancelled: { tone: "warn", label: "Cancelled", Icon: CircleSlash },
};

export function StatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} className={className}>
      <meta.Icon aria-hidden className={cn("size-3", meta.live && "animate-spin")} />
      {meta.label}
    </Badge>
  );
}

export function statusTone(status: RunStatus): Tone {
  return STATUS_META[status].tone;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded", className)} />;
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-1.5 p-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading data</span>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-2">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className={cn("h-5 flex-1", columnIndex === 0 && "max-w-[120px]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {icon ? <div className="text-fg-subtle">{icon}</div> : null}
      <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>
      {description ? <p className="max-w-md text-[12.5px] text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  action,
  className,
}: {
  title?: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex items-start gap-2.5 rounded border border-danger/40 bg-danger-soft px-3 py-2.5", className)}
    >
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-danger">{title}</p>
        <p className="mt-0.5 break-words text-[12.5px] text-fg-muted">{message}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

export function ProgressBar({
  fraction,
  tone = "primary",
  label,
  className,
  indeterminate,
}: {
  fraction: number;
  tone?: Tone;
  label?: string;
  className?: string;
  indeterminate?: boolean;
}) {
  const percent = Math.max(0, Math.min(100, fraction * 100));
  const fill: Record<Tone, string> = {
    neutral: "bg-fg-subtle",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
    primary: "bg-primary",
  };
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
      aria-label={label ?? "Progress"}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", fill[tone], indeterminate && "live-dot w-1/3")}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

export function Sparkline({
  values,
  width = 120,
  height = 28,
  className,
  tone = "var(--primary)",
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  tone?: string;
}) {
  if (values.length < 2) return <div className={cn("h-7", className)} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      role="img"
      aria-label="Trend sparkline"
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-7 w-full", className)}
      preserveAspectRatio="none"
    >
      <polyline points={points} fill="none" stroke={tone} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
