import { cn } from "@/lib/utils/cn";

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      data-panel=""
      className={cn("panel flex min-w-0 flex-col shadow-[var(--shadow-panel)]", className)}
      {...props}
    >
      {children}
    </section>
  );
}

export interface PanelHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  dense?: boolean;
}

export function PanelHeader({ title, subtitle, actions, icon, className, dense }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between gap-3 border-b border-line bg-surface-2/60",
        dense ? "px-2.5 py-1.5" : "px-3 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="text-fg-subtle">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="truncate text-[12.5px] font-semibold uppercase tracking-[0.06em] text-fg-muted">{title}</h2>
          {subtitle ? <p className="truncate text-[11.5px] text-fg-subtle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function PanelBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("min-w-0 flex-1 p-3", className)} {...props}>
      {children}
    </div>
  );
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "info" | "primary";
  icon?: React.ReactNode;
  footer?: React.ReactNode;
}

const TONES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: "text-fg",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  primary: "text-primary",
};

export function StatCard({ label, value, hint, tone = "neutral", icon, footer }: StatCardProps) {
  return (
    <Panel className="gap-0">
      <div className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <span className="text-[11.5px] font-medium uppercase tracking-[0.07em] text-fg-subtle">{label}</span>
        {icon ? <span className={cn("shrink-0", TONES[tone])}>{icon}</span> : null}
      </div>
      <div className="px-3 pb-2.5 pt-1">
        <div className={cn("num text-[26px] font-semibold leading-none tracking-tight", TONES[tone])}>{value}</div>
        {hint ? <p className="mt-1.5 text-[11.5px] text-fg-subtle">{hint}</p> : null}
      </div>
      {footer ? <div className="border-t border-line px-3 py-1.5 text-[11.5px] text-fg-subtle">{footer}</div> : null}
    </Panel>
  );
}

export function KeyValue({
  items,
  columns = 2,
  className,
}: {
  items: { label: string; value: React.ReactNode; mono?: boolean }[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-4 gap-y-1.5",
        columns === 1 ? "grid-cols-1" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-line/60 pb-1">
          <dt className="shrink-0 text-[11.5px] uppercase tracking-[0.05em] text-fg-subtle">{item.label}</dt>
          <dd className={cn("min-w-0 truncate text-right text-[12.5px] text-fg", item.mono !== false && "num")}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
