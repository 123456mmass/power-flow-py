/**
 * Development-only demo accounts.
 *
 * These are fixtures for the in-memory `AuthAdapter`; they are surfaced in the
 * login UI only when `NEXT_PUBLIC_ENABLE_DEMO_CREDENTIALS=true`, and a real
 * deployment replaces the adapter entirely.
 */
export interface DemoAccount {
  id: string;
  email: string;
  password: string;
  name: string;
  role: "engineer" | "analyst" | "viewer" | "admin";
  note: string;
  locked: boolean;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: "u-eng-1",
    email: "engineer@grid.local",
    password: "Stability!2026",
    name: "Dana Okafor",
    role: "engineer",
    note: "Submit, cancel, delete, presets",
    locked: false,
  },
  {
    id: "u-ana-1",
    email: "analyst@grid.local",
    password: "Eigenvalue!2026",
    name: "Miguel Ferrer",
    role: "analyst",
    note: "Read, compare, export",
    locked: false,
  },
  {
    id: "u-view-1",
    email: "viewer@grid.local",
    password: "Observer!2026",
    name: "Ines Halvorsen",
    role: "viewer",
    note: "Read-only dashboards",
    locked: false,
  },
  {
    id: "u-lock-1",
    email: "locked@grid.local",
    password: "Locked!2026",
    name: "Locked Demo",
    role: "viewer",
    note: "Demonstrates the locked-account state",
    locked: true,
  },
];

export function demoCredentialsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_DEMO_CREDENTIALS === "true";
}
