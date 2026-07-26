import {
  Activity,
  BarChart3,
  FileStack,
  GitCompareArrows,
  LayoutDashboard,
  ListOrdered,
  ScrollText,
  Settings,
  Zap,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
  /** Additional path prefixes that should mark this item active. */
  match?: string[];
  shortcut?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "Fleet status, recent analyses and worker health",
    shortcut: "g d",
  },
  {
    href: "/analysis/new",
    label: "New analysis",
    icon: Zap,
    description: "Configure and dispatch a PF, SSSA, TDS or IBR study",
    match: ["/analysis"],
    shortcut: "g n",
  },
  {
    href: "/runs",
    label: "Runs",
    icon: ListOrdered,
    description: "Run history with filters and live monitors",
    match: ["/runs"],
    shortcut: "g r",
  },
  {
    href: "/results",
    label: "Results",
    icon: BarChart3,
    description: "Completed studies, tables and scientific plots",
    match: ["/results"],
    shortcut: "g s",
  },
  {
    href: "/compare",
    label: "Compare",
    icon: GitCompareArrows,
    description: "Overlay two or more runs on aligned axes",
  },
  {
    href: "/presets",
    label: "Presets",
    icon: FileStack,
    description: "Reusable analysis configurations",
  },
  {
    href: "/logs",
    label: "Logs",
    icon: ScrollText,
    description: "Audit trail of user and solver actions",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    description: "Connection, display and streaming preferences",
  },
];

export const MONITOR_ITEM: NavItem = {
  href: "/runs",
  label: "Live monitor",
  icon: Activity,
  description: "Streaming run monitor",
};
