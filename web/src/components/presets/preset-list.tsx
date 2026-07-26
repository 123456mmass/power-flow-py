"use client";

import { Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/overlay";
import { ANALYSIS_LABELS } from "@/lib/domain/catalog";
import { toCliCommand } from "@/lib/domain/cli";
import type { Preset } from "@/lib/domain/types";
import { formatTimestamp } from "@/lib/utils/format";

export function PresetList({ presets, canMutate }: { presets: Preset[]; canMutate: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<Preset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!pending) return;
    setDeleting(true);
    try {
      await fetch(`/api/presets/${pending.id}`, { method: "DELETE" });
      setPending(null);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  if (presets.length === 0) {
    return (
      <EmptyState
        title="No presets saved yet"
        description="Save a configuration from the New analysis workspace to reuse it later."
        action={
          <Link href="/analysis/new" className="text-[12.5px] text-primary hover:underline">
            Open the analysis workspace
          </Link>
        }
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-line">
        {presets.map((preset) => (
          <li key={preset.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[13px] font-semibold text-fg">{preset.name}</h3>
                <Badge tone="primary">{ANALYSIS_LABELS[preset.config.analysis]}</Badge>
                <span className="num text-[11.5px] text-fg-subtle">{preset.config.case}</span>
                {preset.shared ? <Badge>shared</Badge> : null}
              </div>
              <p className="mt-0.5 text-[12.5px] text-fg-muted">{preset.description}</p>
              <code className="num mt-1 block truncate text-[11px] text-fg-subtle">{toCliCommand(preset.config)}</code>
              <p className="num mt-1 text-[11px] text-fg-subtle">
                {preset.owner} · {formatTimestamp(preset.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Link
                href={`/analysis/new?analysis=${preset.config.analysis}&case=${preset.config.case}`}
                className="inline-flex h-8 items-center gap-1.5 rounded border border-line bg-surface-2 px-2.5 text-[12.5px] hover:border-primary/60"
              >
                <Play aria-hidden className="size-3.5 text-primary" />
                Apply
              </Link>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete preset ${preset.name}`}
                disabled={!canMutate}
                onClick={() => setPending(preset)}
              >
                <Trash2 aria-hidden className="size-4 text-danger" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={`Delete preset “${pending?.name ?? ""}”?`}
        description="Runs already dispatched with this preset are unaffected."
        confirmLabel="Delete preset"
        destructive
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </>
  );
}
