import type { Metadata } from "next";

import { PresetList } from "@/components/presets/preset-list";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { getSessionUser } from "@/server/auth/session";
import { readPresets } from "@/server/data";

export const metadata: Metadata = { title: "Presets" };
export const dynamic = "force-dynamic";

export default async function PresetsPage() {
  const presets = await readPresets();
  const user = await getSessionUser();

  return (
    <div className="space-y-2 p-3">
      <header>
        <h1 className="text-[17px] font-semibold tracking-tight">Analysis presets</h1>
        <p className="text-[12.5px] text-fg-muted">
          Stored option sets, including advanced parameters. Applying a preset opens the configuration workspace.
        </p>
      </header>
      <Panel>
        <PanelHeader title="Saved presets" subtitle={`${presets.length} stored configurations`} />
        <PresetList presets={presets} canMutate={user?.role === "engineer" || user?.role === "admin"} />
      </Panel>
    </div>
  );
}
