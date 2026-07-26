"use client";

import { RefreshCw } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-6">
      <div className="panel max-w-2xl p-5">
        <p className="num text-[11.5px] uppercase tracking-[0.08em] text-danger">console error</p>
        <h1 className="mt-1 text-[17px] font-semibold">This view failed to render</h1>
        <p className="mt-2 text-[12.5px] text-fg-muted">
          The console caught an unexpected error. Solver jobs are unaffected — telemetry and results remain on the
          service.
        </p>
        <pre className="num mt-3 max-h-48 overflow-auto rounded border border-line bg-surface-inset p-2 text-[11.5px] text-fg-muted">
          {error.message}
          {error.digest ? `\ndigest: ${error.digest}` : ""}
        </pre>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-[12.5px] font-medium text-primary-fg hover:bg-primary-hover"
        >
          <RefreshCw aria-hidden className="size-3.5" />
          Retry
        </button>
      </div>
    </div>
  );
}
