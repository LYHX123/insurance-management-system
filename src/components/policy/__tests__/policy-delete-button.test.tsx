import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { PolicyDeleteButton } from "@/components/policy/policy-delete-button";
import type { DeletePolicyResult } from "@/lib/policy/deletePolicyRecord";

// Phase 13D UI fix — the permanent-delete launcher + confirmation dialog.
// Real React interaction tests (not source-string assertions): click the
// visible button, prove the modal opens, prove type-to-confirm gating, prove
// a blocked delete shows a visible error and keeps the policy, prove a
// success navigates away.

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, refresh: vi.fn() }),
}));

const RECORD_NUMBER = "PM202609-0068";

function renderButton(deleteAction: (id: string, v: string) => Promise<DeletePolicyResult>) {
  return render(
    <LocaleProvider initialLocale="en">
      <PolicyDeleteButton
        policyId="pol-1"
        recordNumber={RECORD_NUMBER}
        customerName="Acme Ltd"
        categoryLabel="Motor"
        listPath="/policy/motor"
        deleteAction={deleteAction}
      />
    </LocaleProvider>
  );
}

function confirmInput(): HTMLInputElement {
  return screen.getByPlaceholderText(RECORD_NUMBER) as HTMLInputElement;
}
function confirmButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Delete Permanently" }) as HTMLButtonElement;
}

beforeEach(() => vi.clearAllMocks());

describe("PolicyDeleteButton — click path from button to modal", () => {
  it("the launcher button is type=button and does NOT delete on the first click", () => {
    const action = vi.fn();
    renderButton(action);
    const launcher = screen.getByRole("button", { name: "Delete Policy" });
    expect(launcher.getAttribute("type")).toBe("button");
    fireEvent.click(launcher);
    expect(action).not.toHaveBeenCalled();
  });

  it("clicking Delete Policy opens the confirmation modal showing record number, customer and category", () => {
    renderButton(vi.fn());
    expect(screen.queryByText("Permanently Delete Policy?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Delete Policy" }));

    expect(screen.getByText("Permanently Delete Policy?")).toBeTruthy();
    expect(screen.getByText(RECORD_NUMBER)).toBeTruthy();
    expect(screen.getByText("Acme Ltd")).toBeTruthy();
    expect(screen.getByText("Motor")).toBeTruthy();
  });

  it("the confirm button is disabled until the exact record number is typed", () => {
    renderButton(vi.fn());
    fireEvent.click(screen.getByRole("button", { name: "Delete Policy" }));

    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(confirmInput(), { target: { value: "PM202609-0000" } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(confirmInput(), { target: { value: `  ${RECORD_NUMBER}  ` } });
    expect(confirmButton().disabled).toBe(false);
  });

  it("Cancel closes the modal without calling the delete action", () => {
    const action = vi.fn();
    renderButton(action);
    fireEvent.click(screen.getByRole("button", { name: "Delete Policy" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Permanently Delete Policy?")).toBeNull();
    expect(action).not.toHaveBeenCalled();
  });

  it("a blocked (HAS_DEPENDENCIES) result shows a visible alert with the reason and keeps the modal open", async () => {
    const action = vi.fn(
      async (): Promise<DeletePolicyResult> => ({
        success: false,
        error: "HAS_DEPENDENCIES",
        blockers: [{ type: "RENEWAL", count: 1 }],
      })
    );
    renderButton(action);
    fireEvent.click(screen.getByRole("button", { name: "Delete Policy" }));
    fireEvent.change(confirmInput(), { target: { value: RECORD_NUMBER } });
    fireEvent.click(confirmButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("it is part of a renewal chain");
    // modal still open, not navigated
    expect(screen.getByText("Permanently Delete Policy?")).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("a successful result navigates to the list with ?deleted=<recordNumber>", async () => {
    const action = vi.fn(async (): Promise<DeletePolicyResult> => ({ success: true, recordNumber: RECORD_NUMBER }));
    renderButton(action);
    fireEvent.click(screen.getByRole("button", { name: "Delete Policy" }));
    fireEvent.change(confirmInput(), { target: { value: RECORD_NUMBER } });
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(`/policy/motor?deleted=${encodeURIComponent(RECORD_NUMBER)}`)
    );
  });

  it("a CONFIRMATION_MISMATCH from the server shows the mismatch message (defence in depth)", async () => {
    const action = vi.fn(async (): Promise<DeletePolicyResult> => ({ success: false, error: "CONFIRMATION_MISMATCH" }));
    renderButton(action);
    fireEvent.click(screen.getByRole("button", { name: "Delete Policy" }));
    fireEvent.change(confirmInput(), { target: { value: RECORD_NUMBER } });
    fireEvent.click(confirmButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("did not match");
  });
});
