// Pure decision logic for the reminder popup's "auto-open once per login"
// behavior — factored out of reminders-widget.tsx so the exact rule (and the
// regression where it silently stopped firing) is unit-testable without a
// browser/DOM test environment.

// Scoped per account rather than a single fixed key: sessionStorage survives
// across logout/login within the same browser tab, so a fixed key would let
// one account's dismissal silently suppress the very first auto-open for the
// *next* account that logs into that same tab.
export function buildReminderDismissKey(accountKey: string): string {
  return `reminders-auto-dismissed:${accountKey}`;
}

export function shouldAutoOpenReminders(params: {
  loginReminderPopupEnabled: boolean;
  itemCount: number;
  alreadyDismissed: boolean;
}): boolean {
  return params.loginReminderPopupEnabled && !params.alreadyDismissed && params.itemCount > 0;
}
