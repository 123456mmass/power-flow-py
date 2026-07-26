"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Tooltip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils/cn";

type Theme = "dark" | "light";

const STORAGE_KEY = "pfw-theme";

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [systemPreference, setSystemPreference] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readTheme());
    const media = window.matchMedia("(prefers-color-scheme: light)");
    setSystemPreference(media.matches ? "light" : "dark");
    const listener = (event: MediaQueryListEvent) => setSystemPreference(event.matches ? "light" : "dark");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const apply = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  };

  const followsSystem = systemPreference !== null && systemPreference === theme;

  return (
    <Tooltip content={`Theme: ${theme}${followsSystem ? " (matches system)" : ""}. Click to switch.`}>
      <button
        type="button"
        onClick={() => apply(theme === "dark" ? "light" : "dark")}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded border border-transparent text-fg-muted",
          "hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus",
          className,
        )}
      >
        {theme === "dark" ? (
          <Moon aria-hidden className="size-4" />
        ) : (
          <Sun aria-hidden className="size-4" />
        )}
        {followsSystem ? <Monitor aria-hidden className="sr-only" /> : null}
      </button>
    </Tooltip>
  );
}
