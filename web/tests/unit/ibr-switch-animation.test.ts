import { describe, expect, it } from "vitest";

import { deriveIbrDevices } from "@/components/runs/ibr-switch-animation";
import type { SignalDescriptor } from "@/lib/domain/types";

describe("IBR switching one-line device discovery", () => {
  it("prefers the electrical bus in the label over the mock IBR ordinal", () => {
    const signals: SignalDescriptor[] = [
      { id: "mode_ibr1", label: "Control mode IBR 1 (bus 2)", group: "IBR 1 (bus 2)", unit: "0=GFL 1=GFM", panel: "mode", device: "ibr1" },
      { id: "agsi_ibr1", label: "AGSI++ IBR 1 (bus 2)", group: "IBR 1 (bus 2)", unit: "-", panel: "agsi", device: "ibr1" },
    ];

    expect(deriveIbrDevices(signals)).toMatchObject([{ id: "ibr1", bus: 2, mode: "mode_ibr1", agsi: "agsi_ibr1" }]);
  });

  it("discovers Python service dot-separated signal ids", () => {
    const signals: SignalDescriptor[] = [
      { id: "ibr.6.mode", label: "IBR 6 mode", group: "IBRs", unit: "0=GFL 1=GFM", panel: "mode", device: "IBR 6" },
      { id: "ibr.6.agsi", label: "IBR 6 AGSI++", group: "IBRs", unit: "-", panel: "agsi", device: "IBR 6" },
      { id: "bus.6.v", label: "Bus 6 voltage", group: "Buses", unit: "pu", panel: "voltage" },
    ];

    expect(deriveIbrDevices(signals)).toEqual([
      expect.objectContaining({ id: "IBR 6", label: "IBR 6", bus: 6, mode: "ibr.6.mode", agsi: "ibr.6.agsi", voltage: "bus.6.v" }),
    ]);
  });
});
