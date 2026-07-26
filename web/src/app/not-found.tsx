import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-screen items-center justify-center p-6">
      <div className="panel max-w-md p-6">
        <p className="num text-[11.5px] uppercase tracking-[0.08em] text-fg-subtle">error 404</p>
        <h1 className="mt-1 text-[18px] font-semibold">Resource not found</h1>
        <p className="mt-2 text-[12.5px] text-fg-muted">
          The run, result or page you requested does not exist. It may have been deleted, or the id may be mistyped.
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            href="/dashboard"
            className="inline-flex h-8 items-center rounded bg-primary px-3 text-[12.5px] font-medium text-primary-fg hover:bg-primary-hover"
          >
            Back to dashboard
          </Link>
          <Link href="/runs" className="inline-flex h-8 items-center rounded border border-line px-3 text-[12.5px]">
            Browse runs
          </Link>
        </div>
      </div>
    </main>
  );
}
