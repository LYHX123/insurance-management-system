import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { WIBASection } from "../WIBASection";
import { emptyWibaDraft, type WibaDraft } from "@/components/quotations/sectionDrafts";
import { buildWibaFixtureBuffer } from "@/lib/quotationScheduleImport/__tests__/fixtureHelpers";

// Phase 9 — WIBA Schedule Import, Cases 14 & 17: re-import replace
// confirmation, and imported rows remaining fully editable exactly like
// manual entry. Drives the real WIBASection + real ScheduleImportModal
// through an actual file upload; only the network/server-action boundary
// (@/app/(app)/quotation/actions) is mocked.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const parseWibaScheduleAction = vi.fn();
vi.mock("@/app/(app)/quotation/actions", () => ({
  parseWibaScheduleAction: (...args: unknown[]) => parseWibaScheduleAction(...args),
  parseCpmScheduleAction: vi.fn(),
}));

function renderSection(draft: WibaDraft, onChange: (patch: Partial<WibaDraft>) => void) {
  return render(
    <LocaleProvider initialLocale="en">
      <WIBASection draft={draft} onChange={onChange} />
    </LocaleProvider>
  );
}

async function uploadAndParse(fileName = "wiba.xlsx") {
  fireEvent.click(screen.getByText("Import Schedule"));
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  const buffer = await buildWibaFixtureBuffer([
    { occupation: "Mason", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 50 },
  ]);
  const file = new File([buffer], fileName, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(screen.getByText("Parse & Preview"));
  await waitFor(() => expect(screen.getByText("Import Preview")).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WIBASection — Schedule Import", () => {
  it("Case 17: importing into a fresh (empty) section skips the replace-confirmation and hands the mapped rows straight to onChange, fully editable afterward", async () => {
    parseWibaScheduleAction.mockResolvedValue({
      ok: true,
      rows: [
        { rowNumber: 2, occupation: "Mason", basicSalary: "14000", allowance: "3500", otherEarnings: "10000", employeeCount: "50", monthlyEarnings: "1375000", annualEarnings: "16500000", status: "valid", errorCode: null },
      ],
      totals: { totalEmployees: 50, totalMonthlyEarnings: 1375000, totalAnnualEarnings: 16500000 },
      blankRowsSkipped: 0,
      hasErrors: false,
    });

    const onChange = vi.fn();
    renderSection(emptyWibaDraft(), onChange);

    await uploadAndParse();
    fireEvent.click(screen.getByText("Confirm Import"));

    // No re-import confirmation for a fresh/empty draft.
    expect(screen.queryByText("Replace Existing Schedule Data?")).not.toBeInTheDocument();

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0][0] as Partial<WibaDraft>;
    expect(patch.payrollRows).toHaveLength(1);
    expect(patch.payrollRows![0]).toMatchObject({
      occupation: "Mason",
      basicMonthlySalary: "14000",
      monthlyAllowance: "3500",
      monthlyOtherEarnings: "10000",
      employeeCount: "50",
    });
    // Case 17 — the imported row has a real draft key and is therefore
    // exactly like a manually-added row: WIBASection's own updateRow/
    // removeRow machinery (unchanged by this phase) operates on it
    // identically. Re-render with the imported draft to prove it's
    // editable, not locked.
    expect(typeof patch.payrollRows![0].key).toBe("string");

    const importedDraft: WibaDraft = { ...emptyWibaDraft(), payrollRows: patch.payrollRows! };
    const onChange2 = vi.fn();
    renderSection(importedDraft, onChange2);
    const occupationInputs = screen.getAllByDisplayValue("Mason");
    fireEvent.change(occupationInputs[occupationInputs.length - 1], { target: { value: "Senior Mason" } });
    expect(onChange2).toHaveBeenCalledWith({ payrollRows: expect.arrayContaining([expect.objectContaining({ occupation: "Senior Mason" })]) });
  });

  it("Case 14: importing into a section that already has real data shows the replace-confirmation, and only replaces after the user confirms", async () => {
    parseWibaScheduleAction.mockResolvedValue({
      ok: true,
      rows: [
        { rowNumber: 2, occupation: "Carpenter", basicSalary: "14000", allowance: "3500", otherEarnings: "10000", employeeCount: "45", monthlyEarnings: "1237500", annualEarnings: "14850000", status: "valid", errorCode: null },
      ],
      totals: { totalEmployees: 45, totalMonthlyEarnings: 1237500, totalAnnualEarnings: 14850000 },
      blankRowsSkipped: 0,
      hasErrors: false,
    });

    const existingDraft: WibaDraft = {
      wibaRate: "0.5",
      payrollRows: [{ key: "existing-1", occupation: "Existing Occupation", employeeCount: "3", annualWages: "100000", basicMonthlySalary: "", monthlyAllowance: "", monthlyOtherEarnings: "" }],
    };
    const onChange = vi.fn();
    renderSection(existingDraft, onChange);

    await uploadAndParse();
    fireEvent.click(screen.getByText("Confirm Import"));

    // Blocked on the replace-confirmation — onChange must NOT have fired yet.
    expect(screen.getByText("Replace Existing Schedule Data?")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const patch = onChange.mock.calls[0][0] as Partial<WibaDraft>;
    // The existing row is gone — replaced, not appended.
    expect(patch.payrollRows).toHaveLength(1);
    expect(patch.payrollRows![0].occupation).toBe("Carpenter");
  });

  it("Confirm Import is disabled while the preview has any row with an error", async () => {
    parseWibaScheduleAction.mockResolvedValue({
      ok: true,
      rows: [{ rowNumber: 2, occupation: "", basicSalary: "14000", allowance: "", otherEarnings: "", employeeCount: "50", monthlyEarnings: "0", annualEarnings: "0", status: "error", errorCode: "OCCUPATION_REQUIRED" }],
      totals: { totalEmployees: 0, totalMonthlyEarnings: 0, totalAnnualEarnings: 0 },
      blankRowsSkipped: 0,
      hasErrors: true,
    });

    const onChange = vi.fn();
    renderSection(emptyWibaDraft(), onChange);
    await uploadAndParse();

    expect(screen.getByText("Confirm Import")).toBeDisabled();
  });
});
