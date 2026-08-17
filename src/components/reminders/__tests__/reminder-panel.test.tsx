import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { ReminderPanel } from "@/components/reminders/reminder-panel";
import type { ReminderItem } from "@/lib/reminders/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// Phase 7 Part A — the panel's height regressed to feeling "too tall" even
// though a max-height already existed, because that cap was viewport-
// relative (max-h-[70vh]/sm:max-h-[60vh] — 500-750px on a typical desktop
// screen). Reused Printer-Service-System's AlertsNotification pattern
// instead: a small FIXED cap (max-h-96 = 384px) on the scrolling body only,
// no viewport unit anywhere. These tests pin that structural choice down so
// it can't silently regress back to a vh-based cap.

function makeReminder(overrides: Partial<ReminderItem> = {}): ReminderItem {
  return {
    id: `rem-${Math.random()}`,
    category: "policy.motor",
    severity: "due_soon",
    recordId: "policy-1",
    recordNumber: "PM202608-0001",
    customerName: "Acme Ltd",
    extra: null,
    days: 5,
    referenceDate: new Date().toISOString(),
    targetUrl: "/policy/motor/policy-1",
    permissionKey: "policy.motor",
    ...overrides,
  };
}

function renderPanel(reminders: ReminderItem[]) {
  return render(
    <LocaleProvider initialLocale="en">
      <ReminderPanel reminders={reminders} onClose={vi.fn()} />
    </LocaleProvider>
  );
}

describe("ReminderPanel — Phase 7 Part A compact height", () => {
  it("Case 1: renders normally with a single reminder, no scroll-related footer", () => {
    renderPanel([makeReminder()]);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText(/View all reminders/i)).not.toBeInTheDocument();
  });

  it("Case 2: with many reminders, the scrollable body carries a fixed max-height cap and overflow-y-auto — never a viewport-relative unit", () => {
    const many = Array.from({ length: 25 }, (_, i) => makeReminder({ id: `rem-${i}`, recordNumber: `PM202608-${String(i).padStart(4, "0")}` }));
    renderPanel(many);

    const dialog = screen.getByRole("dialog");
    // Outer container must never reintroduce a viewport-relative cap.
    expect(dialog.className).not.toMatch(/vh/);

    // The scrollable body region carries a fixed cap (matches Printer
    // System's AlertsNotification max-h-96) and scrolls internally.
    const scrollBody = dialog.querySelector(".overflow-y-auto");
    expect(scrollBody).toBeTruthy();
    expect(scrollBody!.className).toMatch(/max-h-96/);
    expect(scrollBody!.className).not.toMatch(/vh/);

    // Only the first 10 render initially — the rest are behind "View All".
    expect(screen.getByText(/View all reminders/i)).toBeInTheDocument();
  });

  it("panel never renders anything when there are zero reminders passed a non-empty list", () => {
    renderPanel([]);
    expect(screen.getByText(/No reminders/i)).toBeInTheDocument();
  });
});
