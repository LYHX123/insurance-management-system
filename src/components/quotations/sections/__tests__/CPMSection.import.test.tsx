import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { CPMSection } from "../CPMSection";
import { emptyCpmDraft, type CpmDraft } from "@/components/quotations/sectionDrafts";
import { buildCpmFixtureBuffer } from "@/lib/quotationScheduleImport/__tests__/fixtureHelpers";

// Phase 9 — CPM Schedule Import, Cases 14 & 17 (see the identical WIBA
// coverage in WIBASection.import.test.tsx for the full rationale).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const parseCpmScheduleAction = vi.fn();
vi.mock("@/app/(app)/quotation/actions", () => ({
  parseWibaScheduleAction: vi.fn(),
  parseCpmScheduleAction: (...args: unknown[]) => parseCpmScheduleAction(...args),
}));

function renderSection(draft: CpmDraft, onChange: (patch: Partial<CpmDraft>) => void) {
  return render(
    <LocaleProvider initialLocale="en">
      <CPMSection draft={draft} onChange={onChange} />
    </LocaleProvider>
  );
}

async function uploadAndParse() {
  fireEvent.click(screen.getByText("Import Schedule"));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  const buffer = await buildCpmFixtureBuffer([{ equipmentName: "Excavator", chassisOrPlate: "KDX 123X", quantity: 2, unitValue: 500000 }]);
  const file = new File([buffer], "cpm.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(screen.getByText("Parse & Preview"));
  await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CPMSection — Schedule Import", () => {
  it("Case 17: importing into a fresh section maps chassisOrPlate through to an editable draft row", async () => {
    parseCpmScheduleAction.mockResolvedValue({
      ok: true,
      rows: [{ rowNumber: 2, equipmentName: "Excavator", chassisOrPlate: "KDX 123X", quantity: "2", unitValue: "500000", totalValue: "1000000", status: "valid", errorCode: null }],
      totals: { totalQuantity: 2, totalSumInsured: 1000000 },
      blankRowsSkipped: 0,
      hasErrors: false,
    });

    const onChange = vi.fn();
    renderSection(emptyCpmDraft(), onChange);
    await uploadAndParse();
    fireEvent.click(screen.getByText("Confirm Import"));

    expect(screen.queryByText("Replace Existing Schedule Data?")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0] as Partial<CpmDraft>;
    expect(patch.equipmentRows![0]).toMatchObject({ equipmentName: "Excavator", chassisOrPlate: "KDX 123X", quantity: "2", unitValue: "500000" });

    const importedDraft: CpmDraft = { ...emptyCpmDraft(), equipmentRows: patch.equipmentRows! };
    const onChange2 = vi.fn();
    renderSection(importedDraft, onChange2);
    const chassisInputs = screen.getAllByDisplayValue("KDX 123X");
    fireEvent.change(chassisInputs[chassisInputs.length - 1], { target: { value: "KDX 999Z" } });
    expect(onChange2).toHaveBeenCalledWith({ equipmentRows: expect.arrayContaining([expect.objectContaining({ chassisOrPlate: "KDX 999Z" })]) });
  });

  it("Case 14: re-importing over an existing non-empty section requires confirmation before replacing", async () => {
    parseCpmScheduleAction.mockResolvedValue({
      ok: true,
      rows: [{ rowNumber: 2, equipmentName: "Bulldozer", chassisOrPlate: "", quantity: "1", unitValue: "800000", totalValue: "800000", status: "valid", errorCode: null }],
      totals: { totalQuantity: 1, totalSumInsured: 800000 },
      blankRowsSkipped: 0,
      hasErrors: false,
    });

    const existingDraft: CpmDraft = {
      cpmRate: "0.3",
      pvtLoadingEnabled: false,
      pvtLoadingRate: "",
      equipmentRows: [{ key: "existing-1", equipmentName: "Old Equipment", quantity: "1", unitValue: "1", chassisOrPlate: "" }],
    };
    const onChange = vi.fn();
    renderSection(existingDraft, onChange);
    await uploadAndParse();
    fireEvent.click(screen.getByText("Confirm Import"));

    expect(screen.getByText("Replace Existing Schedule Data?")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const patch = onChange.mock.calls[0][0] as Partial<CpmDraft>;
    expect(patch.equipmentRows).toHaveLength(1);
    expect(patch.equipmentRows![0].equipmentName).toBe("Bulldozer");
  });
});
