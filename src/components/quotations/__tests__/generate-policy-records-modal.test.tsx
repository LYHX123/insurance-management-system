import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { GeneratePolicyRecordsModal } from "@/components/quotations/generate-policy-records-modal";
import type { SectionRow } from "@/components/quotations/types";

// Phase 3 "per-section cover periods" — each QuotationInsuranceSection row
// in the modal must carry its own independent Effective/Expiry Date input
// (never a single batch-wide date), the top Default Effective/Expiry Date
// fields must only quick-fill rows the user hasn't edited directly, and a
// row the user HAS edited directly must never be overwritten by a later
// default-date change. Unselected/disabled sections must never require
// (or submit) date/insurerCost data.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const generatePolicyRecordsActionMock = vi.fn();
vi.mock("@/app/(app)/quotation/generatePolicyRecordsAction", () => ({
  generatePolicyRecordsAction: (...args: unknown[]) => generatePolicyRecordsActionMock(...args),
}));

// Phase 4 "Policy Number + Document at generation time" — STEP B reuses
// this EXACT existing Server Action (never a duplicate upload path), so
// the mock's shape/args are what every STEP-B test below asserts against.
const uploadPolicyDocumentActionMock = vi.fn();
vi.mock("@/app/(app)/policy/motor/documentActions", () => ({
  uploadPolicyDocumentAction: (...args: unknown[]) => uploadPolicyDocumentActionMock(...args),
}));

function makeFile(name: string): File {
  return new File(["dummy content"], name, { type: "application/pdf" });
}

function baseSection(overrides: Partial<SectionRow>): SectionRow {
  return {
    id: "sec-x",
    insuranceTypeId: "type-x",
    insuranceTypeNameSnapshot: "Section X",
    sectionKind: "GENERIC",
    generatedPolicy: null,
    policyGenerationSupported: true,
    description: null,
    phcfRate: "0.25",
    itlRate: "0.20",
    stampDuty: "40",
    applyPHCF: true,
    applyITL: true,
    applyStampDuty: true,
    basePremium: "0",
    phcfAmount: "0",
    itlAmount: "0",
    sectionTotal: "0",
    clausesSnapshot: null,
    exclusionsSnapshot: null,
    conditionsSnapshot: null,
    sortOrder: 0,
    items: [],
    carDetail: null,
    wibaDetail: null,
    cpmDetail: null,
    publicLiabilityDetail: null,
    fireDetail: null,
    burglaryDetail: null,
    gitSingleDetail: null,
    gitAnnualDetail: null,
    marineDetail: null,
    motorCompPrivateDetail: null,
    motorCompCommercialDetail: null,
    motorTpoPrivateDetail: null,
    motorTpoCommercialDetail: null,
    gpaDetail: null,
    medicalDetail: null,
    tenderSecurityDetail: null,
    performanceBondDetail: null,
    advancePaymentGuaranteeDetail: null,
    customsBondDetail: null,
    ...overrides,
  };
}

const CAR_SECTION = baseSection({ id: "sec-car", insuranceTypeNameSnapshot: "CAR", sectionKind: "CAR_PACKAGE", sectionTotal: "500000" });
const WIBA_SECTION = baseSection({ id: "sec-wiba", insuranceTypeNameSnapshot: "WIBA", sectionKind: "WIBA", sectionTotal: "80000" });
const EL_SECTION = baseSection({
  id: "sec-el",
  insuranceTypeNameSnapshot: "Employers' Liability",
  sectionKind: "EMPLOYERS_LIABILITY",
  sectionTotal: "60000",
});
const GENERATED_SECTION = baseSection({
  id: "sec-generated",
  insuranceTypeNameSnapshot: "Already Generated Section",
  sectionKind: "GIT_SINGLE",
  sectionTotal: "10000",
  generatedPolicy: { id: "policy-1", recordNumber: "PN202608-0001", category: "NON_MOTOR" },
});
const UNSUPPORTED_SECTION = baseSection({
  id: "sec-unsupported",
  insuranceTypeNameSnapshot: "Unsupported Section",
  sectionKind: "GENERIC",
  sectionTotal: "5000",
  policyGenerationSupported: false,
});

function renderModal(sections: SectionRow[]) {
  return render(
    <LocaleProvider initialLocale="en">
      <GeneratePolicyRecordsModal quotationId="quot-1" quotationNumber="QT202608-001" sections={sections} onClose={vi.fn()} />
    </LocaleProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  generatePolicyRecordsActionMock.mockResolvedValue({ success: true, created: [], alreadyGenerated: [] });
  uploadPolicyDocumentActionMock.mockResolvedValue({ success: true, id: "doc-1" });
});

async function fillCarAndWiba() {
  fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });
  fireEvent.change(screen.getByLabelText("Expiry Date — CAR"), { target: { value: "2027-08-19" } });
  fireEvent.change(screen.getByLabelText("Effective Date — WIBA"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("Expiry Date — WIBA"), { target: { value: "2027-08-31" } });
}

describe("GeneratePolicyRecordsModal — per-section dates", () => {
  it("renders an independent Effective/Expiry Date input for every selected, creatable section", () => {
    renderModal([CAR_SECTION, WIBA_SECTION]);

    expect(screen.getByLabelText("Effective Date — CAR")).toBeInTheDocument();
    expect(screen.getByLabelText("Expiry Date — CAR")).toBeInTheDocument();
    expect(screen.getByLabelText("Effective Date — WIBA")).toBeInTheDocument();
    expect(screen.getByLabelText("Expiry Date — WIBA")).toBeInTheDocument();
  });

  it("editing one row's date never affects another row's date", () => {
    renderModal([CAR_SECTION, WIBA_SECTION]);

    const carEffective = screen.getByLabelText("Effective Date — CAR") as HTMLInputElement;
    const wibaEffective = screen.getByLabelText("Effective Date — WIBA") as HTMLInputElement;

    fireEvent.change(carEffective, { target: { value: "2026-08-20" } });

    expect(carEffective.value).toBe("2026-08-20");
    expect(wibaEffective.value).toBe("");
  });

  it("Already Generated sections show no date inputs and their checkbox is disabled", () => {
    renderModal([GENERATED_SECTION]);

    expect(screen.queryByLabelText("Effective Date — Already Generated Section")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Already Generated Section")).toBeDisabled();
    expect(screen.getByText("Generated")).toBeInTheDocument();
  });

  it("Unsupported sections show no date inputs and their checkbox is disabled", () => {
    renderModal([UNSUPPORTED_SECTION]);

    expect(screen.queryByLabelText("Effective Date — Unsupported Section")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Unsupported Section")).toBeDisabled();
    expect(screen.getByText("Unsupported for automatic generation")).toBeInTheDocument();
  });

  it("unchecking a section hides its date inputs and excludes it from submission", async () => {
    renderModal([CAR_SECTION, WIBA_SECTION]);

    fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — CAR"), { target: { value: "2027-08-19" } });
    fireEvent.change(screen.getByLabelText("Effective Date — WIBA"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — WIBA"), { target: { value: "2027-08-31" } });

    // Uncheck WIBA — its date inputs disappear entirely.
    fireEvent.click(screen.getByLabelText("WIBA"));
    expect(screen.queryByLabelText("Effective Date — WIBA")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(generatePolicyRecordsActionMock).toHaveBeenCalledTimes(1);
    const payload = generatePolicyRecordsActionMock.mock.calls[0][0];
    expect(payload.sections).toHaveLength(1);
    expect(payload.sections[0].sectionId).toBe("sec-car");
  });

  it("Default Effective Date fills every selected, untouched row but never overwrites a row the user already edited", () => {
    renderModal([CAR_SECTION, WIBA_SECTION, EL_SECTION]);

    // User manually edits CAR's own Effective Date first.
    fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });

    // Then sets the top Default Effective Date.
    fireEvent.change(screen.getByLabelText("Default Effective Date"), { target: { value: "2026-09-01" } });

    const car = screen.getByLabelText("Effective Date — CAR") as HTMLInputElement;
    const wiba = screen.getByLabelText("Effective Date — WIBA") as HTMLInputElement;
    const el = screen.getByLabelText("Effective Date — Employers' Liability") as HTMLInputElement;

    // CAR keeps the user's manual value — never overwritten by the default.
    expect(car.value).toBe("2026-08-20");
    // WIBA/EL, never touched individually, pick up the new default.
    expect(wiba.value).toBe("2026-09-01");
    expect(el.value).toBe("2026-09-01");
  });

  it("changing the Default Effective Date again keeps updating only still-untouched rows", () => {
    renderModal([CAR_SECTION, WIBA_SECTION]);

    fireEvent.change(screen.getByLabelText("Default Effective Date"), { target: { value: "2026-09-01" } });
    // User now directly edits WIBA.
    fireEvent.change(screen.getByLabelText("Effective Date — WIBA"), { target: { value: "2026-10-10" } });
    // Default changes again.
    fireEvent.change(screen.getByLabelText("Default Effective Date"), { target: { value: "2026-11-11" } });

    const car = screen.getByLabelText("Effective Date — CAR") as HTMLInputElement;
    const wiba = screen.getByLabelText("Effective Date — WIBA") as HTMLInputElement;

    expect(car.value).toBe("2026-11-11"); // untouched — follows the latest default
    expect(wiba.value).toBe("2026-10-10"); // touched — frozen at the user's own value
  });

  it("submits a section-level payload with each row's own effectiveDate/expiryDate/insurerCost and the batch processingDate", async () => {
    renderModal([CAR_SECTION, WIBA_SECTION]);

    fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — CAR"), { target: { value: "2027-08-19" } });
    fireEvent.change(screen.getByLabelText("Insurer Cost — CAR"), { target: { value: "400000" } });
    fireEvent.change(screen.getByLabelText("Effective Date — WIBA"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — WIBA"), { target: { value: "2027-08-31" } });
    fireEvent.change(screen.getByLabelText("Insurer Cost — WIBA"), { target: { value: "60000" } });

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(generatePolicyRecordsActionMock).toHaveBeenCalledTimes(1);
    const payload = generatePolicyRecordsActionMock.mock.calls[0][0];
    expect(payload.quotationId).toBe("quot-1");
    expect(typeof payload.processingDate).toBe("string");
    expect(payload.sections).toHaveLength(2);
    expect(payload.sections).toEqual(
      expect.arrayContaining([
        { sectionId: "sec-car", insurerCost: "400000", effectiveDate: "2026-08-20", expiryDate: "2027-08-19", policyNumber: "" },
        { sectionId: "sec-wiba", insurerCost: "60000", effectiveDate: "2026-09-01", expiryDate: "2027-08-31", policyNumber: "" },
      ])
    );
  });

  it("blocks submission client-side when a selected row is missing a date, without calling the server action", async () => {
    renderModal([CAR_SECTION]);
    // Deliberately leave CAR's dates blank.

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await Promise.resolve();

    expect(generatePolicyRecordsActionMock).not.toHaveBeenCalled();
    expect(screen.getByText("Please enter both an effective date and an expiry date.")).toBeInTheDocument();
  });
});

describe("GeneratePolicyRecordsModal — Policy Number + Document (Phase 4)", () => {
  it("renders an independent Policy Number input and file input for every selected, creatable section", () => {
    renderModal([CAR_SECTION, WIBA_SECTION]);

    expect(screen.getByLabelText("Policy Number — CAR")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload Document — CAR")).toBeInTheDocument();
    expect(screen.getByLabelText("Policy Number — WIBA")).toBeInTheDocument();
    expect(screen.getByLabelText("Upload Document — WIBA")).toBeInTheDocument();
  });

  it("Policy Number and file inputs never appear for Generated or Unsupported sections", () => {
    renderModal([GENERATED_SECTION, UNSUPPORTED_SECTION]);

    expect(screen.queryByLabelText("Policy Number — Already Generated Section")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Policy Number — Unsupported Section")).not.toBeInTheDocument();
  });

  it("Case 4: policyNumber is OPTIONAL — Generate is never blocked by a blank Policy Number", async () => {
    renderModal([CAR_SECTION]);
    fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — CAR"), { target: { value: "2027-08-19" } });
    // Policy Number deliberately left blank.

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(generatePolicyRecordsActionMock).toHaveBeenCalledTimes(1));

    const payload = generatePolicyRecordsActionMock.mock.calls[0][0];
    expect(payload.sections[0].policyNumber).toBe("");
  });

  it("Case 5: a blank file selection never blocks generation, and no upload call is made", async () => {
    generatePolicyRecordsActionMock.mockResolvedValue({
      success: true,
      created: [{ sectionId: "sec-car", id: "policy-car-1", recordNumber: "PN202608-0001", category: "NON_MOTOR", policyNumber: null }],
      alreadyGenerated: [],
    });
    renderModal([CAR_SECTION]);
    fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — CAR"), { target: { value: "2027-08-19" } });
    // No file selected.

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("1 policy record(s) generated successfully.")).toBeInTheDocument());

    expect(uploadPolicyDocumentActionMock).not.toHaveBeenCalled();
  });

  it("Case 1/2: submits each section's own Policy Number and uploads each section's own file to its own newly-created policyRecordId — never cross-contaminated", async () => {
    generatePolicyRecordsActionMock.mockResolvedValue({
      success: true,
      created: [
        { sectionId: "sec-car", id: "policy-car-1", recordNumber: "PN202608-0001", category: "NON_MOTOR", policyNumber: "PN-CAR" },
        { sectionId: "sec-wiba", id: "policy-wiba-1", recordNumber: "PN202608-0002", category: "NON_MOTOR", policyNumber: "PN-WIBA" },
      ],
      alreadyGenerated: [],
    });
    renderModal([CAR_SECTION, WIBA_SECTION]);
    await fillCarAndWiba();
    fireEvent.change(screen.getByLabelText("Policy Number — CAR"), { target: { value: "PN-CAR" } });
    fireEvent.change(screen.getByLabelText("Policy Number — WIBA"), { target: { value: "PN-WIBA" } });

    const carFile = makeFile("car-policy.pdf");
    const wibaFile = makeFile("wiba-policy.pdf");
    fireEvent.change(screen.getByLabelText("Upload Document — CAR"), { target: { files: [carFile] } });
    fireEvent.change(screen.getByLabelText("Upload Document — WIBA"), { target: { files: [wibaFile] } });

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("2 policy record(s) generated successfully.")).toBeInTheDocument());

    // STEP A payload carries each section's own policyNumber.
    const createPayload = generatePolicyRecordsActionMock.mock.calls[0][0];
    expect(createPayload.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sectionId: "sec-car", policyNumber: "PN-CAR" }),
        expect.objectContaining({ sectionId: "sec-wiba", policyNumber: "PN-WIBA" }),
      ])
    );

    // STEP B: one upload call per created section, each targeting its OWN
    // policyRecordId with its OWN file — never swapped.
    expect(uploadPolicyDocumentActionMock).toHaveBeenCalledTimes(2);
    const calls = uploadPolicyDocumentActionMock.mock.calls.map((args: unknown[]) => {
      const formData = args[0] as FormData;
      return {
        policyRecordId: formData.get("policyRecordId"),
        fileName: (formData.get("file") as File).name,
        documentType: formData.get("documentType"),
      };
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        { policyRecordId: "policy-car-1", fileName: "car-policy.pdf", documentType: "POLICY_SCHEDULE" },
        { policyRecordId: "policy-wiba-1", fileName: "wiba-policy.pdf", documentType: "POLICY_SCHEDULE" },
      ])
    );
  });

  it("Case 3: only the section with a selected file gets an upload call", async () => {
    generatePolicyRecordsActionMock.mockResolvedValue({
      success: true,
      created: [
        { sectionId: "sec-car", id: "policy-car-1", recordNumber: "PN202608-0001", category: "NON_MOTOR", policyNumber: null },
        { sectionId: "sec-wiba", id: "policy-wiba-1", recordNumber: "PN202608-0002", category: "NON_MOTOR", policyNumber: null },
      ],
      alreadyGenerated: [],
    });
    renderModal([CAR_SECTION, WIBA_SECTION]);
    await fillCarAndWiba();
    fireEvent.change(screen.getByLabelText("Upload Document — CAR"), { target: { files: [makeFile("car-policy.pdf")] } });
    // WIBA gets no file.

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("2 policy record(s) generated successfully.")).toBeInTheDocument());

    expect(uploadPolicyDocumentActionMock).toHaveBeenCalledTimes(1);
    const [formData] = uploadPolicyDocumentActionMock.mock.calls[0] as [FormData];
    expect(formData.get("policyRecordId")).toBe("policy-car-1");
  });

  it("never uploads for an alreadyGenerated section even if its row happened to carry a file from before it was disabled", async () => {
    generatePolicyRecordsActionMock.mockResolvedValue({
      success: true,
      created: [{ sectionId: "sec-wiba", id: "policy-wiba-1", recordNumber: "PN202608-0002", category: "NON_MOTOR", policyNumber: null }],
      alreadyGenerated: ["sec-car"],
    });
    renderModal([CAR_SECTION, WIBA_SECTION]);
    await fillCarAndWiba();
    fireEvent.change(screen.getByLabelText("Upload Document — CAR"), { target: { files: [makeFile("car-policy.pdf")] } });
    fireEvent.change(screen.getByLabelText("Upload Document — WIBA"), { target: { files: [makeFile("wiba-policy.pdf")] } });

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("1 policy record(s) generated successfully.")).toBeInTheDocument());

    // "created" only contains sec-wiba — CAR was alreadyGenerated, so it is
    // never an upload target no matter what its row's file state was.
    expect(uploadPolicyDocumentActionMock).toHaveBeenCalledTimes(1);
    const [formData] = uploadPolicyDocumentActionMock.mock.calls[0] as [FormData];
    expect(formData.get("policyRecordId")).toBe("policy-wiba-1");
  });

  it("Case 6/7: a document upload failure never fails the whole batch — success + per-section failure message shown together", async () => {
    generatePolicyRecordsActionMock.mockResolvedValue({
      success: true,
      created: [
        { sectionId: "sec-car", id: "policy-car-1", recordNumber: "PN202608-0001", category: "NON_MOTOR", policyNumber: null },
        { sectionId: "sec-wiba", id: "policy-wiba-1", recordNumber: "PN202608-0002", category: "NON_MOTOR", policyNumber: null },
        { sectionId: "sec-el", id: "policy-el-1", recordNumber: "PN202608-0003", category: "NON_MOTOR", policyNumber: null },
      ],
      alreadyGenerated: [],
    });
    uploadPolicyDocumentActionMock.mockImplementation(async (formData: FormData) => {
      if (formData.get("policyRecordId") === "policy-wiba-1") return { success: false, error: "UPLOAD_FAILED" };
      return { success: true, id: "doc-ok" };
    });

    renderModal([CAR_SECTION, WIBA_SECTION, EL_SECTION]);
    fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — CAR"), { target: { value: "2027-08-19" } });
    fireEvent.change(screen.getByLabelText("Effective Date — WIBA"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — WIBA"), { target: { value: "2027-08-31" } });
    fireEvent.change(screen.getByLabelText("Effective Date — Employers' Liability"), { target: { value: "2026-09-15" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — Employers' Liability"), { target: { value: "2027-09-14" } });
    fireEvent.change(screen.getByLabelText("Upload Document — CAR"), { target: { files: [makeFile("car.pdf")] } });
    fireEvent.change(screen.getByLabelText("Upload Document — WIBA"), { target: { files: [makeFile("wiba.pdf")] } });
    // EL: no file at all.

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    // All 3 Policy Records were created — the document failure is reported
    // separately, never as an overall Generate failure.
    await waitFor(() => expect(screen.getByText("3 policy record(s) generated successfully.")).toBeInTheDocument());
    expect(screen.getByText("1 policy document(s) failed to upload and can be uploaded later from the Policy module.")).toBeInTheDocument();
    expect(screen.getByText("WIBA", { exact: false })).toBeInTheDocument();
  });

  it("clicking Done on the result summary closes the modal", async () => {
    const onClose = vi.fn();
    generatePolicyRecordsActionMock.mockResolvedValue({
      success: true,
      created: [{ sectionId: "sec-car", id: "policy-car-1", recordNumber: "PN202608-0001", category: "NON_MOTOR", policyNumber: null }],
      alreadyGenerated: [],
    });
    render(
      <LocaleProvider initialLocale="en">
        <GeneratePolicyRecordsModal quotationId="quot-1" quotationNumber="QT202608-001" sections={[CAR_SECTION]} onClose={onClose} />
      </LocaleProvider>
    );
    fireEvent.change(screen.getByLabelText("Effective Date — CAR"), { target: { value: "2026-08-20" } });
    fireEvent.change(screen.getByLabelText("Expiry Date — CAR"), { target: { value: "2027-08-19" } });

    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument());

    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
