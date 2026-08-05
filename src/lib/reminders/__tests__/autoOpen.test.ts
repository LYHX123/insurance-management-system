import { describe, it, expect } from "vitest";
import { buildReminderDismissKey, shouldAutoOpenReminders } from "../autoOpen";

// Regression coverage for the "auto-open on login" popup that silently
// stopped firing: verified here as the exact decision RemindersWidget makes
// (CASE 1/2/3 from the audit), and the per-account dismiss-key scoping that
// fixes it (a fixed key let one test account's dismissal suppress the very
// first auto-open for the next account logging into the same browser tab).

describe("shouldAutoOpenReminders (CASE 1/2/3)", () => {
  it("CASE 1: reminders exist, popup enabled, not yet dismissed -> auto-opens", () => {
    expect(shouldAutoOpenReminders({ loginReminderPopupEnabled: true, itemCount: 3, alreadyDismissed: false })).toBe(true);
  });

  it("CASE 2: no reminders -> never auto-opens, even if enabled and not dismissed", () => {
    expect(shouldAutoOpenReminders({ loginReminderPopupEnabled: true, itemCount: 0, alreadyDismissed: false })).toBe(false);
  });

  it("CASE 3: already dismissed this session -> does not re-open even though reminders exist", () => {
    expect(shouldAutoOpenReminders({ loginReminderPopupEnabled: true, itemCount: 5, alreadyDismissed: true })).toBe(false);
  });

  it("the Settings toggle (loginReminderPopupEnabled) can suppress auto-open independently of reminder count", () => {
    expect(shouldAutoOpenReminders({ loginReminderPopupEnabled: false, itemCount: 5, alreadyDismissed: false })).toBe(false);
  });
});

describe("buildReminderDismissKey (per-account scoping — the actual fix)", () => {
  it("produces different keys for different accounts", () => {
    const a = buildReminderDismissKey("Alice Wang");
    const b = buildReminderDismissKey("Bob Chen");
    expect(a).not.toBe(b);
  });

  it("produces the same key for the same account across renders (idempotent)", () => {
    expect(buildReminderDismissKey("Alice Wang")).toBe(buildReminderDismissKey("Alice Wang"));
  });

  it("switching accounts in the same browser tab does not inherit the previous account's dismissal", () => {
    // Simulates sessionStorage in one tab across a login -> close -> logout -> different login.
    const store = new Map<string, string>();
    const dismiss = (accountKey: string) => store.set(buildReminderDismissKey(accountKey), "1");
    const isDismissed = (accountKey: string) => store.get(buildReminderDismissKey(accountKey)) === "1";

    dismiss("Alice Wang"); // Alice logs in, sees the popup, closes it.
    expect(isDismissed("Alice Wang")).toBe(true);
    // Bob logs into the very same tab next — must get his own fresh chance.
    expect(isDismissed("Bob Chen")).toBe(false);
  });
});
