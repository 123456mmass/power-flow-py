"use client";

import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "warning" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-fg hover:bg-primary-hover border border-transparent shadow-sm disabled:bg-primary/50",
  secondary:
    "bg-surface-3 text-fg hover:bg-surface-2 border border-line hover:border-line-strong",
  outline: "bg-transparent text-fg border border-line hover:bg-surface-2 hover:border-line-strong",
  ghost: "bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg border border-transparent",
  danger: "bg-danger text-white hover:brightness-110 border border-transparent",
  warning: "bg-warn-soft text-warn border border-warn/40 hover:bg-warn/20",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-8.5 px-3 text-[13px] gap-2",
  lg: "h-10 px-4 text-[14px] gap-2",
  icon: "h-8 w-8 justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center rounded font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
        "disabled:cursor-not-allowed disabled:opacity-55",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
});
